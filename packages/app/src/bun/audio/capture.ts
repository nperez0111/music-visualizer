import { findAudiocapBinary } from "../paths";
import type { RingBuffer } from "./ring-buffer";
import type { AudioSource } from "../../shared/rpc-types";

// Protocol constants (must match audiocap):
//   stdout: framed binary
//     u32 magic = 0xA1D10A1D
//     u32 channels
//     u32 sampleRate
//     u32 frameCount   (samples per channel)
//     f32 LE * channels * frameCount   (interleaved if stereo)
//   stderr: newline-delimited JSON status events
const FRAME_MAGIC = 0xa1d10a1d;
const FRAME_HEADER_BYTES = 16;

export type CaptureStatus =
	| "idle"
	| "starting"
	| "capturing"
	| "permission-denied"
	| "binary-missing"
	| "error";

export type CaptureEvent =
	| { type: "ready" }
	| { type: "started"; sampleRate: number; channels: number }
	| { type: "stopped" }
	| { type: "permission-denied" }
	| { type: "error"; message: string };

type StatusListener = (status: CaptureStatus, detail?: string) => void;

export class AudioCapture {
	status: CaptureStatus = "idle";
	sampleRate = 48000;
	channels = 2;
	source: AudioSource = "system";

	private proc: Bun.Subprocess | null = null;
	private listeners: StatusListener[] = [];
	// Pre-allocated parsing state: reusable concat buffer grows as needed
	// (never shrinks) so steady-state pipe reads produce zero allocations.
	private pendingLen = 0;
	private concatBuf = new Uint8Array(32768);
	private concatView = new DataView(this.concatBuf.buffer);

	constructor(private readonly buffer: RingBuffer) {}

	onStatusChange(fn: StatusListener): void {
		this.listeners.push(fn);
	}

	private setStatus(status: CaptureStatus, detail?: string) {
		this.status = status;
		for (const l of this.listeners) l(status, detail);
	}

	async start(source?: AudioSource): Promise<void> {
		if (this.status === "starting" || this.status === "capturing") return;
		if (source) this.source = source;
		const binary = findAudiocapBinary();
		if (!binary) {
			this.setStatus(
				"binary-missing",
				"audiocap binary not found; run `bun run build:audiocap`",
			);
			return;
		}
		this.setStatus("starting");
		const args = [binary];
		if (this.source === "mic") args.push("--mic");
		try {
			this.proc = Bun.spawn(args, {
				stdout: "pipe",
				stderr: "pipe",
				stdin: "ignore",
			});
		} catch (err) {
			this.setStatus("error", String(err));
			return;
		}

		void this.consumeStdout();
		void this.consumeStderr();

		void this.proc.exited.then((code) => {
			if (this.status === "capturing" || this.status === "starting") {
				this.setStatus(code === 0 ? "idle" : "error", `audiocap exited with code ${code}`);
			}
			this.proc = null;
		});
	}

	/** Stop current capture, switch source, and restart. */
	async switchSource(source: AudioSource): Promise<void> {
		this.stop();
		// Small delay to allow the previous process to fully terminate.
		await new Promise((r) => setTimeout(r, 100));
		await this.start(source);
	}

	stop(): void {
		if (!this.proc) return;
		try {
			this.proc.kill();
		} catch {}
		this.proc = null;
		this.setStatus("idle");
	}

	private async consumeStdout() {
		if (!this.proc?.stdout) return;
		const reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader();
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) this.parseFrames(value);
			}
		} catch (err) {
			this.setStatus("error", `stdout read failed: ${err}`);
		}
	}

	private async consumeStderr() {
		if (!this.proc?.stderr) return;
		const reader = (this.proc.stderr as ReadableStream<Uint8Array>).getReader();
		const decoder = new TextDecoder();
		let buf = "";
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (value) {
					buf += decoder.decode(value, { stream: true });
					let nl: number;
					while ((nl = buf.indexOf("\n")) !== -1) {
						const line = buf.slice(0, nl).trim();
						buf = buf.slice(nl + 1);
						if (line) this.handleStatusLine(line);
					}
				}
			}
		} catch (err) {
			this.setStatus("error", `stderr read failed: ${err}`);
		}
	}

	private handleStatusLine(line: string) {
		let evt: CaptureEvent;
		try {
			evt = JSON.parse(line) as CaptureEvent;
		} catch {
			console.warn("[audio] non-JSON stderr from audiocap:", line);
			return;
		}
		switch (evt.type) {
			case "ready":
				// audiocap is alive; "started" follows once the loopback stream is built.
				break;
			case "started":
				this.sampleRate = evt.sampleRate;
				this.channels = evt.channels;
				this.setStatus("capturing");
				break;
			case "stopped":
				this.setStatus("idle");
				break;
			case "permission-denied":
				this.setStatus("permission-denied");
				break;
			case "error":
				this.setStatus("error", evt.message);
				break;
		}
	}

	/** Ensure concatBuf is large enough for `needed` bytes, growing if necessary. */
	private ensureConcatCapacity(needed: number): void {
		if (this.concatBuf.byteLength >= needed) return;
		// Double or use needed, whichever is larger.
		const newSize = Math.max(this.concatBuf.byteLength * 2, needed);
		const newBuf = new Uint8Array(newSize);
		newBuf.set(this.concatBuf.subarray(0, this.pendingLen));
		this.concatBuf = newBuf;
		this.concatView = new DataView(newBuf.buffer);
	}

	private parseFrames(chunk: Uint8Array) {
		// Append chunk to the reusable concat buffer (no allocation in steady state).
		const totalLen = this.pendingLen + chunk.byteLength;
		this.ensureConcatCapacity(totalLen);
		this.concatBuf.set(chunk, this.pendingLen);
		this.pendingLen = totalLen;

		let offset = 0;
		const view = this.concatView;
		while (this.pendingLen - offset >= FRAME_HEADER_BYTES) {
			const magic = view.getUint32(offset, true);
			if (magic !== FRAME_MAGIC) {
				// Resync: skip one byte and try again. Should be rare given a
				// trustworthy producer; logging once would help diagnose.
				offset += 1;
				continue;
			}
			const channels = view.getUint32(offset + 4, true);
			const sampleRate = view.getUint32(offset + 8, true);
			const frameCount = view.getUint32(offset + 12, true);
			const payloadBytes = channels * frameCount * 4;
			const totalBytes = FRAME_HEADER_BYTES + payloadBytes;
			if (this.pendingLen - offset < totalBytes) break; // wait for more

			// The payload starts at a 16-byte aligned offset (header is 16 bytes),
			// so it's 4-byte aligned — safe to wrap as Float32Array directly from
			// the concat buffer without a copy.
			const payloadStart = offset + FRAME_HEADER_BYTES;
			const payload = new Float32Array(
				this.concatBuf.buffer,
				payloadStart,
				channels * frameCount,
			);

			if (this.sampleRate !== sampleRate) this.sampleRate = sampleRate;
			if (this.channels !== channels) this.channels = channels;

			if (channels === 2) {
				this.buffer.writeStereoInterleaved(payload, frameCount);
			} else if (channels === 1) {
				this.buffer.writeMono(payload, frameCount);
			} else {
				// ≥3 channels: average all of them down to mono.
				const tmp = new Float32Array(frameCount);
				const inv = 1 / channels;
				for (let f = 0; f < frameCount; f++) {
					let sum = 0;
					const base = f * channels;
					for (let c = 0; c < channels; c++) sum += payload[base + c];
					tmp[f] = sum * inv;
				}
				this.buffer.writeMono(tmp, frameCount);
			}

			offset += totalBytes;
		}

		// Shift remaining bytes to the front of concatBuf (no allocation).
		const remaining = this.pendingLen - offset;
		if (remaining > 0 && offset > 0) {
			this.concatBuf.copyWithin(0, offset, this.pendingLen);
		}
		this.pendingLen = remaining;
	}
}

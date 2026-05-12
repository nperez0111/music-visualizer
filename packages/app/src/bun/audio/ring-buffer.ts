/**
 * Mono Float32 ring buffer. Capture pushes incoming PCM (after a stereo->mono
 * mixdown for analysis); the renderer pulls the most recent N samples once
 * per frame.
 */
export class RingBuffer {
	private buf: Float32Array;
	private writeIdx = 0;
	private filled = 0;
	/** Monotonically increasing counter bumped on every write. Lets consumers
	 *  skip work when no new data has arrived since their last read. */
	private _generation = 0;

	constructor(public readonly capacity: number) {
		this.buf = new Float32Array(capacity);
	}

	/** Current write generation — increments on every write call. */
	get generation(): number {
		return this._generation;
	}

	writeMono(samples: Float32Array, count: number): void {
		const cap = this.capacity;
		let w = this.writeIdx;
		for (let i = 0; i < count; i++) {
			this.buf[w] = samples[i];
			w++;
			if (w === cap) w = 0;
		}
		this.writeIdx = w;
		this.filled = Math.min(cap, this.filled + count);
		this._generation++;
	}

	/**
	 * Mix interleaved stereo (L,R,L,R,...) to mono and write `frameCount`
	 * frames. Avoids creating an intermediate buffer.
	 */
	writeStereoInterleaved(samples: Float32Array, frameCount: number): void {
		const cap = this.capacity;
		let w = this.writeIdx;
		for (let f = 0; f < frameCount; f++) {
		const l = samples[f * 2];
		const r = samples[f * 2 + 1];
			this.buf[w] = (l + r) * 0.5;
			w++;
			if (w === cap) w = 0;
		}
		this.writeIdx = w;
		this.filled = Math.min(cap, this.filled + frameCount);
		this._generation++;
	}

	/**
	 * Copy the most-recent `n` samples into `out` in chronological order.
	 * If fewer than `n` samples have been written, leading slots are zero.
	 * Uses two-part subarray copy instead of per-element modulo.
	 */
	readWindow(n: number, out: Float32Array): void {
		const cap = this.capacity;
		const available = this.filled;
		const writeFrom = Math.max(0, n - available);
		if (writeFrom > 0) out.fill(0, 0, writeFrom);
		const count = n - writeFrom;
		if (count <= 0) return;
		const start = (this.writeIdx - count + cap) % cap;
		const firstChunk = Math.min(count, cap - start);
		out.set(this.buf.subarray(start, start + firstChunk), writeFrom);
		if (firstChunk < count) {
			// Wrap around: copy the remainder from the beginning of the buffer.
			out.set(this.buf.subarray(0, count - firstChunk), writeFrom + firstChunk);
		}
	}

	hasEnough(n: number): boolean {
		return this.filled >= n;
	}

	get framesWritten(): number {
		return this.filled;
	}
}

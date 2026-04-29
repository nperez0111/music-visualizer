/**
 * Mono Float32 ring buffer. Capture pushes incoming PCM (after a stereo->mono
 * mixdown for analysis); the renderer pulls the most recent N samples once
 * per frame.
 */
export class RingBuffer {
	private buf: Float32Array;
	private writeIdx = 0;
	private filled = 0;

	constructor(public readonly capacity: number) {
		this.buf = new Float32Array(capacity);
	}

	writeMono(samples: Float32Array, count: number): void {
		const cap = this.capacity;
		let w = this.writeIdx;
		for (let i = 0; i < count; i++) {
			this.buf[w] = samples[i]!;
			w++;
			if (w === cap) w = 0;
		}
		this.writeIdx = w;
		this.filled = Math.min(cap, this.filled + count);
	}

	/**
	 * Mix interleaved stereo (L,R,L,R,...) to mono and write `frameCount`
	 * frames. Avoids creating an intermediate buffer.
	 */
	writeStereoInterleaved(samples: Float32Array, frameCount: number): void {
		const cap = this.capacity;
		let w = this.writeIdx;
		for (let f = 0; f < frameCount; f++) {
			const l = samples[f * 2]!;
			const r = samples[f * 2 + 1]!;
			this.buf[w] = (l + r) * 0.5;
			w++;
			if (w === cap) w = 0;
		}
		this.writeIdx = w;
		this.filled = Math.min(cap, this.filled + frameCount);
	}

	/**
	 * Copy the most-recent `n` samples into `out` in chronological order.
	 * If fewer than `n` samples have been written, leading slots are zero.
	 */
	readWindow(n: number, out: Float32Array): void {
		const cap = this.capacity;
		const available = this.filled;
		const start = (this.writeIdx - n + cap) % cap;
		const writeFrom = Math.max(0, n - available);
		for (let i = 0; i < writeFrom; i++) out[i] = 0;
		for (let i = writeFrom; i < n; i++) {
			out[i] = this.buf[(start + i) % cap]!;
		}
	}

	hasEnough(n: number): boolean {
		return this.filled >= n;
	}

	get framesWritten(): number {
		return this.filled;
	}
}

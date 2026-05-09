import type { RingBuffer } from "./ring-buffer";

export type AudioFeatures = {
	rms: number;
	peak: number;
	bass: number;
	mid: number;
	treble: number;
	bpm: number;
	beat_phase: number;
};

export const ZERO_FEATURES: AudioFeatures = {
	rms: 0,
	peak: 0,
	bass: 0,
	mid: 0,
	treble: 0,
	bpm: 120,
	beat_phase: 0,
};

// Cooley-Tukey radix-2 in-place FFT. `n` must be a power of two.
// Twiddle factors are precomputed once per `n` and cached.
const twiddleCache = new Map<number, { cos: Float32Array; sin: Float32Array }>();

function getTwiddles(n: number) {
	let t = twiddleCache.get(n);
	if (!t) {
		const cos = new Float32Array(n / 2);
		const sin = new Float32Array(n / 2);
		for (let i = 0; i < n / 2; i++) {
			const a = (-2 * Math.PI * i) / n;
			cos[i] = Math.cos(a);
			sin[i] = Math.sin(a);
		}
		t = { cos, sin };
		twiddleCache.set(n, t);
	}
	return t;
}

function fft(re: Float32Array, im: Float32Array, n: number) {
	// Bit-reversal permutation.
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			const tr = re[i]!;
			re[i] = re[j]!;
			re[j] = tr;
			const ti = im[i]!;
			im[i] = im[j]!;
			im[j] = ti;
		}
	}
	const { cos, sin } = getTwiddles(n);
	for (let size = 2; size <= n; size <<= 1) {
		const half = size >> 1;
		const step = n / size;
		for (let i = 0; i < n; i += size) {
			for (let j = i, k = 0; j < i + half; j++, k += step) {
				const wr = cos[k]!;
				const wi = sin[k]!;
				const tr = wr * re[j + half]! - wi * im[j + half]!;
				const ti = wr * im[j + half]! + wi * re[j + half]!;
				re[j + half] = re[j]! - tr;
				im[j + half] = im[j]! - ti;
				re[j] = re[j]! + tr;
				im[j] = im[j]! + ti;
			}
		}
	}
}

/**
 * Stateful audio analyzer. Holds preallocated buffers; call `compute()` once
 * per render frame. Produces RMS, peak, energy bands, and a beat tracker
 * built on spectral flux + autocorrelation BPM estimation.
 *
 * Algorithm summary:
 *   1. Compute magnitude spectrum each frame.
 *   2. Spectral flux = sum of positive bin-by-bin deltas vs. last frame
 *      (catches mid/treble onsets the old bass-only flux missed).
 *   3. Adaptive threshold: flux > moving-mean × multiplier triggers a beat.
 *   4. Push flux into a circular onset envelope (~8s at 60 fps).
 *   5. Every ~0.5s, autocorrelate the envelope over BPM-relevant lags
 *      (40–240 BPM) and pick the peak; smooth into the running BPM.
 *   6. beat_phase advances continuously between beats using the estimated
 *      period; resets to 0 on each detected onset.
 */
const ONSET_BUFFER_LEN = 512;
const AUTOCORR_INTERVAL_MS = 500;
const MIN_BPM = 60;
const MAX_BPM = 200;
const FLUX_HISTORY_LEN = 43; // ~0.7s at 60 fps for the moving threshold.

export class AudioAnalyzer {
	private windowed: Float32Array;
	private re: Float32Array;
	private im: Float32Array;
	private hann: Float32Array;
	private bins: Float32Array;
	private prevBins: Float32Array;

	// Onset / beat tracking state.
	private onsetEnv: Float32Array = new Float32Array(ONSET_BUFFER_LEN);
	private onsetIdx = 0;
	private onsetFilled = 0;
	private fluxHistory: Float32Array = new Float32Array(FLUX_HISTORY_LEN);
	private fluxHistoryIdx = 0;
	private lastBeatTime = 0;
	private beatIntervalMs = 500; // 120 BPM seed
	private lastAutocorrTime = 0;
	// Track frame deltas so autocorrelation can convert from sample-lags to ms.
	private frameDtMs = 16.7;
	private prevComputeMs = 0;

	constructor(
		private readonly buffer: RingBuffer,
		public sampleRate: number,
		public readonly fftSize: number,
	) {
		this.windowed = new Float32Array(fftSize);
		this.re = new Float32Array(fftSize);
		this.im = new Float32Array(fftSize);
		this.bins = new Float32Array(fftSize / 2);
		this.prevBins = new Float32Array(fftSize / 2);
		this.hann = new Float32Array(fftSize);
		for (let i = 0; i < fftSize; i++) {
			this.hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
		}
	}

	/** Returns spectral magnitudes as a Float32Array of length fftSize/2. */
	get magnitudeSpectrum(): Float32Array {
		return this.bins;
	}

	private estimateBpm(): number | null {
		// Autocorrelation across BPM-relevant lags. Only the most recent ~6 seconds
		// of envelope is meaningful; earlier samples may not even be filled yet.
		const filled = this.onsetFilled;
		if (filled < 64) return null;
		const dt = Math.max(8, this.frameDtMs);
		const minLag = Math.max(2, Math.round(60000 / MAX_BPM / dt));
		const maxLag = Math.min(filled - 1, Math.round(60000 / MIN_BPM / dt));
		if (maxLag <= minLag + 1) return null;

		// Build a contiguous "recent" view, oldest-first: samples in onsetEnv form
		// a ring with `onsetIdx` pointing at the next write slot.
		const N = filled;
		const env = this.onsetEnv;
		const ring = ONSET_BUFFER_LEN;
		const start = (this.onsetIdx - N + ring) % ring;
		// Mean-subtract for cleaner autocorrelation peaks.
		let mean = 0;
		for (let i = 0; i < N; i++) mean += env[(start + i) % ring]!;
		mean /= N;

		let bestLag = -1;
		let bestVal = -Infinity;
		for (let lag = minLag; lag <= maxLag; lag++) {
			let sum = 0;
			const end = N - lag;
			for (let i = 0; i < end; i++) {
				const a = env[(start + i) % ring]! - mean;
				const b = env[(start + i + lag) % ring]! - mean;
				sum += a * b;
			}
			if (sum > bestVal) {
				bestVal = sum;
				bestLag = lag;
			}
		}
		if (bestLag <= 0 || bestVal <= 0) return null;
		return 60000 / (bestLag * dt);
	}

	compute(nowMs: number): AudioFeatures {
		const n = this.fftSize;
		if (!this.buffer.hasEnough(n / 4)) {
			return ZERO_FEATURES;
		}

		// Track average frame interval for the autocorrelation lag↔ms conversion.
		if (this.prevComputeMs > 0) {
			const dt = Math.max(1, Math.min(100, nowMs - this.prevComputeMs));
			this.frameDtMs = this.frameDtMs * 0.95 + dt * 0.05;
		}
		this.prevComputeMs = nowMs;

		this.buffer.readWindow(n, this.windowed);

		// RMS / peak directly from the unwindowed time-domain window.
		let sumSq = 0;
		let peak = 0;
		for (let i = 0; i < n; i++) {
			const v = this.windowed[i]!;
			sumSq += v * v;
			const a = Math.abs(v);
			if (a > peak) peak = a;
		}
		const rms = Math.sqrt(sumSq / n);

		// Apply Hann window into the FFT input.
		for (let i = 0; i < n; i++) {
			this.re[i] = this.windowed[i]! * this.hann[i]!;
			this.im[i] = 0;
		}
		fft(this.re, this.im, n);

		const half = n / 2;
		// Magnitudes for this frame; also accumulate spectral flux against the
		// previous frame's spectrum.
		let flux = 0;
		for (let i = 0; i < half; i++) {
			const m = Math.hypot(this.re[i]!, this.im[i]!) / n;
			const d = m - this.prevBins[i]!;
			if (d > 0) flux += d;
			this.prevBins[i] = m;
			this.bins[i] = m;
		}

		const binHz = this.sampleRate / n;
		const bandSum = (loHz: number, hiHz: number) => {
			const lo = Math.max(1, Math.floor(loHz / binHz));
			const hi = Math.min(half - 1, Math.ceil(hiHz / binHz));
			let sum = 0;
			for (let i = lo; i <= hi; i++) sum += this.bins[i]!;
			return sum / (hi - lo + 1);
		};
		const bass = Math.min(1, bandSum(20, 200) * 12);
		const mid = Math.min(1, bandSum(200, 2000) * 8);
		const treble = Math.min(1, bandSum(2000, 12000) * 8);

		// Push flux into the onset envelope (post-half-wave rectification implicit
		// because we only counted positive deltas) and into the rolling threshold.
		this.onsetEnv[this.onsetIdx] = flux;
		this.onsetIdx = (this.onsetIdx + 1) % ONSET_BUFFER_LEN;
		if (this.onsetFilled < ONSET_BUFFER_LEN) this.onsetFilled++;
		this.fluxHistory[this.fluxHistoryIdx] = flux;
		this.fluxHistoryIdx = (this.fluxHistoryIdx + 1) % FLUX_HISTORY_LEN;
		let fluxMean = 0;
		for (let i = 0; i < FLUX_HISTORY_LEN; i++) fluxMean += this.fluxHistory[i]!;
		fluxMean /= FLUX_HISTORY_LEN;

		// Adaptive threshold; require both an absolute floor and a multiple of the
		// recent mean so quiet sections don't generate false beats.
		const fluxFloor = 0.0008;
		const onset = flux > fluxFloor && flux > fluxMean * 1.6;
		const sinceLast = nowMs - this.lastBeatTime;
		if (onset && sinceLast > 250) {
			this.lastBeatTime = nowMs;
		}

		// Periodic BPM estimation; cheaper to re-run only every ~0.5s.
		if (nowMs - this.lastAutocorrTime > AUTOCORR_INTERVAL_MS) {
			this.lastAutocorrTime = nowMs;
			const est = this.estimateBpm();
			if (est !== null && est >= MIN_BPM && est <= MAX_BPM) {
				const newInterval = 60000 / est;
				// Smooth aggressively; autocorrelation is already noise-robust.
				this.beatIntervalMs = this.beatIntervalMs * 0.6 + newInterval * 0.4;
			}
		}

		const bpm = 60000 / this.beatIntervalMs;
		// Phase advances from the last detected beat using the BPM-derived period.
		const phaseRaw = (nowMs - this.lastBeatTime) / this.beatIntervalMs;
		const phase = phaseRaw - Math.floor(phaseRaw);

		return {
			rms,
			peak,
			bass,
			mid,
			treble,
			bpm,
			beat_phase: Math.max(0, Math.min(1, phase)),
		};
	}
}

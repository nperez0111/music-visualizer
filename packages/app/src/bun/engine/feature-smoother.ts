import type { AudioAnalyzer, AudioFeatures } from "../audio/analysis";
import { ZERO_FEATURES } from "../audio/analysis";

/**
 * Wraps the per-frame audio feature gathering + EMA smoothing + log-spaced
 * spectrum binning. Owns three Float32 buffers; callers read `smoothed` and
 * `spectrum` after `update()` returns.
 *
 * Returns the live (unsmoothed) features when audio capture produced real
 * data, otherwise null — caller uses this to decide whether to push an
 * audio-level meter update over RPC.
 */
export class FeatureSmoother {
	readonly smoothed: AudioFeatures = { ...ZERO_FEATURES };
	readonly spectrum: Float32Array;
	private readonly displaySpectrum: Float32Array;

	constructor(
		private readonly analyzer: AudioAnalyzer,
		private readonly bins: number,
	) {
		this.spectrum = new Float32Array(bins);
		this.displaySpectrum = new Float32Array(bins);
	}

	update(nowMs: number, elapsedSec: number, capturing: boolean): AudioFeatures | null {
		let raw: AudioFeatures;
		let live: AudioFeatures | null = null;
		if (!capturing) {
			raw = fakeFeatures(elapsedSec);
			this.fillFakeSpectrum(elapsedSec);
		} else {
			const f = this.analyzer.compute(nowMs);
			if (f === ZERO_FEATURES) {
				raw = fakeFeatures(elapsedSec);
				this.fillFakeSpectrum(elapsedSec);
			} else {
				raw = f;
				live = f;
				this.fillSpectrumFromAnalyzer();
			}
		}
		this.smoothFeatures(raw);
		this.smoothSpectrumPass();
		return live;
	}

	private fillFakeSpectrum(elapsed: number): void {
		fakeSpectrum(elapsed, this.displaySpectrum);
	}

	private fillSpectrumFromAnalyzer(): void {
		const mags = this.analyzer.magnitudeSpectrum;
		const halfBins = mags.length;
		const sampleRate = this.analyzer.sampleRate;
		const minHz = 30;
		const maxHz = sampleRate * 0.5;
		const ratio = Math.log(maxHz / minHz);
		const binHz = sampleRate / (halfBins * 2);
		for (let i = 0; i < this.bins; i++) {
			const fLo = minHz * Math.exp((ratio * i) / this.bins);
			const fHi = minHz * Math.exp((ratio * (i + 1)) / this.bins);
			const lo = Math.max(1, Math.floor(fLo / binHz));
			const hi = Math.min(halfBins - 1, Math.max(lo, Math.ceil(fHi / binHz)));
			let sum = 0;
			for (let j = lo; j <= hi; j++) sum += mags[j]!;
			// Average per band so high-freq bins (which cover many FFT bins on a
			// log scale) don't get inflated relative to bass bins. Matches the
			// per-band averaging already used by bandSum in analysis.ts.
			this.displaySpectrum[i] = sum / (hi - lo + 1);
		}
	}

	private smoothFeatures(target: AudioFeatures): void {
		const a = 0.2;
		const s = this.smoothed;
		s.rms = ema(s.rms, target.rms, a);
		// peak uses asymmetric attack/release so beats snap and tail off.
		s.peak = Math.max(s.peak * 0.9, target.peak);
		s.bass = ema(s.bass, target.bass, a);
		s.mid = ema(s.mid, target.mid, a);
		s.treble = ema(s.treble, target.treble, a);
		s.bpm = ema(s.bpm, target.bpm, 0.1);
		s.beat_phase = target.beat_phase;
	}

	private smoothSpectrumPass(): void {
		const a = 0.35;
		for (let i = 0; i < this.bins; i++) {
			this.spectrum[i] = ema(this.spectrum[i]!, this.displaySpectrum[i]!, a);
		}
	}
}

function ema(prev: number, next: number, alpha: number): number {
	return prev * (1 - alpha) + next * alpha;
}

/** Synthetic audio features used by the no-capture preview and headless rendering. Pure function of `elapsed`. */
export function fakeFeatures(elapsed: number): AudioFeatures {
	const fast = Math.sin(elapsed * 7.0);
	return {
		rms: 0.4 + 0.3 * Math.sin(elapsed * 1.5),
		peak: 0.7 + 0.3 * fast,
		bass: 0.5 + 0.5 * Math.max(0, Math.sin(elapsed * 2.0)),
		mid: 0.5 + 0.5 * Math.sin(elapsed * 3.3 + 1.0),
		treble: 0.5 + 0.5 * Math.sin(elapsed * 6.1 + 2.0),
		bpm: 120,
		beat_phase: (elapsed * (120 / 60)) % 1.0,
	};
}

/** Fills `out` with the same fake spectrum the live preview uses. Pure function of `elapsed`. */
export function fakeSpectrum(elapsed: number, out: Float32Array): void {
	const bins = out.length;
	for (let i = 0; i < bins; i++) {
		const k = i / bins;
		out[i] = 0.05 + Math.max(0, Math.sin(elapsed * (1 + k * 4) + i * 0.3)) * (1 - k) * 0.6;
	}
}

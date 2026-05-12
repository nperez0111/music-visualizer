import { ptr } from "bun:ffi";
import { WGPU, asPtr } from "../gpu/electrobun-gpu";
import type { AudioFeatures } from "../audio/analysis";
import type { Pack } from "../packs/loader";
import {
	packParameterValues,
	parameterFloatCount,
	type ParamValueMap,
} from "../packs/parameters";
import type { Renderer } from "../gpu/renderer";
import type { PackPipeline } from "../gpu/pipeline";

/**
 * Owns the per-frame uniform staging buffer and the WASM feature/parameter
 * scratch arrays. One instance per process; reused across packs.
 *
 * Uniform layout (must match every pack's WGSL `Uniforms` struct):
 *   bytes [0,   176): host-filled — time/delta/resolution + features +
 *                     32-bin spectrum
 *   bytes [176, 512): pack-defined — Tier 2 WASM may write up to
 *                     PACK_BYTES into this region; otherwise zero.
 */
export class UniformWriter {
	readonly bufferSize: number;
	readonly packOffset: number;
	private readonly bins: number;
	private readonly staging: ArrayBuffer;
	private readonly view: DataView;
	private readonly bytes: Uint8Array;
	private readonly wasmFeatureScratch = new Float32Array(8);
	private readonly emptyParams = new Float32Array(0);
	private readonly paramScratch = new Map<string, Float32Array>();

	constructor(opts: {
		bufferSize: number;
		packOffset: number;
		spectrumBins: number;
	}) {
		this.bufferSize = opts.bufferSize;
		this.packOffset = opts.packOffset;
		this.bins = opts.spectrumBins;
		this.staging = new ArrayBuffer(opts.bufferSize);
		this.view = new DataView(this.staging);
		this.bytes = new Uint8Array(this.staging);
	}

	/**
	 * Write the host portion of the uniform buffer. Called once per frame
	 * before any per-pack `write()` calls — the pack-specific region is
	 * written separately (and may be overwritten by WASM output).
	 */
	fillHost(
		nowMs: number,
		startTimeMs: number,
		deltaMs: number,
		size: { width: number; height: number },
		features: AudioFeatures,
		spectrum: Float32Array,
	): void {
		const v = this.view;
		v.setFloat32(0, nowMs - startTimeMs, true);
		v.setFloat32(4, deltaMs, true);
		v.setFloat32(8, size.width, true);
		v.setFloat32(12, size.height, true);
		v.setFloat32(16, features.rms, true);
		v.setFloat32(20, features.peak, true);
		v.setFloat32(24, features.bass, true);
		v.setFloat32(28, features.mid, true);
		v.setFloat32(32, features.treble, true);
		v.setFloat32(36, features.bpm, true);
		v.setFloat32(40, features.beat_phase, true);
		v.setFloat32(44, 0, true);
		for (let i = 0; i < this.bins; i++) {
			v.setFloat32(48 + i * 4, spectrum[i], true);
		}
	}

	/**
	 * Pack one pack's parameters + WASM custom region into our staging buffer
	 * and copy it into the pack's GPU-bound uniform buffer. Also writes the
	 * pack's parameter buffer if declared.
	 */
	write(
		nowMs: number,
		startTimeMs: number,
		pack: Pack,
		pipeline: PackPipeline,
		paramValues: ParamValueMap,
		renderer: Renderer,
		features: AudioFeatures,
	): void {
		let packedParams: Float32Array | null = null;
		if (pack.parameters.length > 0) {
			packedParams = this.ensureParamScratch(pack);
			packParameterValues(pack.parameters, paramValues, packedParams);
		}

		// Refill the pack-defined region: default zeros, overwrite with WASM
		// bytes if the pack ships WASM.
		this.bytes.fill(0, this.packOffset, this.bufferSize);
		if (pack.wasmRuntime) {
			const f = this.wasmFeatureScratch;
			f[0] = features.rms;
			f[1] = features.peak;
			f[2] = features.bass;
			f[3] = features.mid;
			f[4] = features.treble;
			f[5] = features.bpm;
			f[6] = features.beat_phase;
			f[7] = 0;
			try {
				const packBytes = pack.wasmRuntime.frame(
					nowMs - startTimeMs,
					f,
					packedParams ?? this.emptyParams,
				);
				const copyLen = Math.min(packBytes.byteLength, this.bufferSize - this.packOffset);
				this.bytes.set(packBytes.subarray(0, copyLen), this.packOffset);
			} catch (err) {
				console.warn(`[packs] WASM frame error for "${pack.id}":`, err);
			}
		}

		const native = WGPU.native;
		native.symbols.wgpuQueueWriteBuffer(
			asPtr(renderer.queue),
			asPtr(pipeline.uniformBuffer),
			0,
			ptr(this.staging),
			this.bufferSize,
		);

		if (pipeline.paramBuffer && packedParams) {
			native.symbols.wgpuQueueWriteBuffer(
				asPtr(renderer.queue),
				asPtr(pipeline.paramBuffer),
				0,
				ptr(packedParams.buffer),
				pipeline.paramBufferSize,
			);
		}
	}

	private ensureParamScratch(p: Pack): Float32Array {
		let s = this.paramScratch.get(p.id);
		const need = parameterFloatCount(p.parameters);
		if (!s || s.length !== need) {
			s = new Float32Array(Math.max(need, 4));
			this.paramScratch.set(p.id, s);
		}
		return s;
	}
}

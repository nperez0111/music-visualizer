import { ptr } from "bun:ffi";
import { writeFileSync } from "fs";
import { encodeAnimation } from "wasm-webp";
import { WGPU, WGPUBridge, asPtr } from "../gpu/electrobun-gpu";

import {
	alignTo,
	BufferUsage_CopyDst,
	BufferUsage_MapRead,
	makeBufferDescriptor,
	makeCommandBufferArray,
	makeCommandEncoderDescriptor,
	makeExtent3D,
	makeRenderPassColorAttachment,
	makeRenderPassDescriptor,
	makeSamplerDescriptor,
	makeTexelCopyBufferInfo,
	makeTexelCopyTextureInfo,
	makeTextureDescriptor,
	TextureFormat_BGRA8Unorm,
	TextureUsage_CopyDst,
	TextureUsage_CopySrc,
	TextureUsage_RenderAttachment,
	TextureUsage_TextureBinding,
} from "../gpu/wgpu-helpers";
import {
	createPackPipeline,
	releasePackPipeline,
	type PackPipeline,
} from "../gpu/pipeline";
import { createHeadlessRenderer } from "../gpu/renderer";
import { fakeFeatures, fakeSpectrum } from "../engine/feature-smoother";
import { UniformWriter } from "../engine/uniform-writer";
import { defaultParameterValues, parameterBufferSize } from "./parameters";
import type { ParamValueMap } from "./parameters";
import { encodeRgbaPng } from "./png-encode";
import type { Pack } from "./loader";
import type { AudioFeatures } from "../audio/analysis";

const SPECTRUM_BINS = 32;
const UNIFORM_BUFFER_SIZE = 16384;
const PACK_UNIFORM_OFFSET = 176;

/** Max iterations of the wgpu-event poll loop before giving up on a readback. */
const READBACK_POLL_ITERATIONS = 1000;

/** Default render resolution for headless captures (PNG and WebP). */
export const DEFAULT_RENDER_WIDTH = 640;
export const DEFAULT_RENDER_HEIGHT = 480;
/** Default number of frames to simulate (2 s @ 60fps). */
export const DEFAULT_RENDER_FRAMES = 120;

export type RenderPackToPngOptions = {
	pack: Pack;
	/** Output image width. Default DEFAULT_RENDER_WIDTH (640). */
	width?: number;
	/** Output image height. Default DEFAULT_RENDER_HEIGHT (480). */
	height?: number;
	/** Frames to render before capturing the last one. Default DEFAULT_RENDER_FRAMES (120). */
	frames?: number;
	/** Where to write the PNG. The directory must already exist. */
	outPath: string;
	/**
	 * Override pack parameter values. Keys are parameter names from the
	 * manifest; unknown keys are silently ignored. Values are merged onto
	 * the manifest defaults.
	 */
	paramOverrides?: ParamValueMap;
	/**
	 * Override synthetic audio features. Partial — unset fields fall back
	 * to `fakeFeatures(elapsed)`. Applied every frame (the overridden
	 * fields stay constant while the non-overridden fields still animate).
	 */
	audioOverrides?: Partial<AudioFeatures>;
	/**
	 * Capture PNGs at these frame indices (0-based) in addition to the
	 * final frame. Each captured frame is written to `outPath` with a
	 * `_frame<N>` suffix before the extension (e.g. `/tmp/foo_frame30.png`).
	 * The final frame is always written to `outPath` unchanged.
	 */
	captureFrames?: number[];
	/**
	 * Capture PNGs at these simulated times (in seconds). Each time is
	 * mapped to the nearest frame index. Output paths use a `_t<N>s`
	 * suffix (e.g. `/tmp/foo_t1.50s.png`). The total frame count is
	 * automatically extended to cover the latest capture time if needed.
	 */
	captureTimesS?: number[];
};

/**
 * Render `pack` for `frames` frames headlessly (no window, no audio capture)
 * and write the final frame to `outPath` as a PNG. Audio features are filled
 * with the same deterministic synthetic curves the live preview uses when no
 * capture is running, so output is reproducible across runs.
 */
export async function renderPackToPng(opts: RenderPackToPngOptions): Promise<void> {
	const width = opts.width ?? DEFAULT_RENDER_WIDTH;
	const height = opts.height ?? DEFAULT_RENDER_HEIGHT;
	let frames = Math.max(1, opts.frames ?? DEFAULT_RENDER_FRAMES);
	const dtMs = 1000 / 60;
	const native = WGPU.native;

	const renderer = createHeadlessRenderer({ width, height });
	const encoderDesc = makeCommandEncoderDescriptor();

	const targetDesc = makeTextureDescriptor(
		width,
		height,
		TextureFormat_BGRA8Unorm,
		TextureUsage_RenderAttachment | TextureUsage_TextureBinding | TextureUsage_CopySrc,
	);
	const targetTex = native.symbols.wgpuDeviceCreateTexture(asPtr(renderer.device), asPtr(targetDesc.ptr)) as number;
	if (!targetTex) throw new Error("failed to create offscreen target texture");
	const targetView = native.symbols.wgpuTextureCreateView(asPtr(targetTex), asPtr(0)) as number;
	if (!targetView) throw new Error("failed to create offscreen target view");

	let prevTex = 0;
	let prevView = 0;
	let prevSampler = 0;
	if (opts.pack.usesPrevFrame) {
		const prevDesc = makeTextureDescriptor(
			width,
			height,
			TextureFormat_BGRA8Unorm,
			TextureUsage_TextureBinding | TextureUsage_CopyDst,
		);
		prevTex = native.symbols.wgpuDeviceCreateTexture(asPtr(renderer.device), asPtr(prevDesc.ptr)) as number;
		if (!prevTex) throw new Error("failed to create prev-frame texture");
		prevView = native.symbols.wgpuTextureCreateView(asPtr(prevTex), asPtr(0)) as number;
		const samplerDesc = makeSamplerDescriptor();
		prevSampler = native.symbols.wgpuDeviceCreateSampler(asPtr(renderer.device), asPtr(samplerDesc.ptr)) as number;
		if (!prevSampler) throw new Error("failed to create prev-frame sampler");
	}

	const pipeline = createPackPipeline({
		renderer,
		shaderText: opts.pack.shaderText,
		uniformBufferSize: UNIFORM_BUFFER_SIZE,
		paramBufferSize:
			opts.pack.parameters.length > 0 ? parameterBufferSize(opts.pack.parameters) : 0,
		usesPrevFrame: opts.pack.usesPrevFrame,
		prevFrameView: prevView,
		prevFrameSampler: prevSampler,
		extraPassShaders: opts.pack.extraPasses,
		chainWidth: width,
		chainHeight: height,
	});

	const uniforms = new UniformWriter({
		bufferSize: UNIFORM_BUFFER_SIZE,
		packOffset: PACK_UNIFORM_OFFSET,
		spectrumBins: SPECTRUM_BINS,
	});
	const synthSpectrum = new Float32Array(SPECTRUM_BINS);
	const paramValues = defaultParameterValues(opts.pack.parameters);
	if (opts.paramOverrides) {
		for (const [k, v] of Object.entries(opts.paramOverrides)) {
			if (k in paramValues) paramValues[k] = v;
		}
	}
	// Build a map of frame-index → capture path suffix for all capture requests.
	// captureFrames uses `_frame<N>`, captureTimesS uses `_t<seconds>s`.
	const captureMap = new Map<number, string>();
	if (opts.captureFrames) {
		for (const f of opts.captureFrames) captureMap.set(f, `_frame${f}`);
	}
	if (opts.captureTimesS) {
		for (const t of opts.captureTimesS) {
			const fi = Math.round(t * 60);
			// Extend frame count to cover this capture time
			if (fi >= frames) frames = fi + 1;
			const label = t % 1 === 0 ? `_t${t.toFixed(1)}s` : `_t${t}s`;
			captureMap.set(fi, label);
		}
	}

	const prevCopySrc = opts.pack.usesPrevFrame ? makeTexelCopyTextureInfo(targetTex) : null;
	const prevCopyDst = opts.pack.usesPrevFrame ? makeTexelCopyTextureInfo(prevTex) : null;
	const prevCopyExtent = opts.pack.usesPrevFrame ? makeExtent3D(width, height, 1) : null;

	try {
		for (let frameIdx = 0; frameIdx < frames; frameIdx++) {
			const elapsedSec = (frameIdx * dtMs) / 1000;
			const features = opts.audioOverrides
				? { ...fakeFeatures(elapsedSec), ...opts.audioOverrides }
				: fakeFeatures(elapsedSec);
			fakeSpectrum(elapsedSec, synthSpectrum);
			const nowMs = frameIdx * dtMs;

			uniforms.fillHost(nowMs, 0, dtMs, { width, height }, features, synthSpectrum);
			uniforms.write(nowMs, 0, opts.pack, pipeline, paramValues, renderer, features);

			native.symbols.wgpuInstanceProcessEvents(asPtr(renderer.instance));

			const encoder = native.symbols.wgpuDeviceCreateCommandEncoder(
				asPtr(renderer.device),
				asPtr(encoderDesc.ptr),
			) as number;
			renderPackPass(encoder, pipeline, targetView);
			if (prevCopySrc && prevCopyDst && prevCopyExtent) {
				native.symbols.wgpuCommandEncoderCopyTextureToTexture(
					asPtr(encoder),
					asPtr(prevCopySrc.ptr),
					asPtr(prevCopyDst.ptr),
					asPtr(prevCopyExtent.ptr),
				);
			}
			const cmd = native.symbols.wgpuCommandEncoderFinish(asPtr(encoder), asPtr(0)) as number;
			const cmdArray = makeCommandBufferArray(cmd);
			native.symbols.wgpuQueueSubmit(asPtr(renderer.queue), 1, asPtr(cmdArray.ptr));
			native.symbols.wgpuCommandBufferRelease(asPtr(cmd));
			native.symbols.wgpuCommandEncoderRelease(asPtr(encoder));

			// WASM packs run their viz_frame on a worker; sleeping for ~one frame
			// keeps framesPending under the deadline (see runtime.ts:128).
			if (opts.pack.wasmRuntime) await Bun.sleep(8);

			const capSuffix = captureMap.get(frameIdx);
			if (capSuffix !== undefined) {
				const capPath = captureSuffixPath(opts.outPath, capSuffix);
				await readbackAndWritePng(renderer, targetTex, width, height, capPath);
			}
		}

		await readbackAndWritePng(renderer, targetTex, width, height, opts.outPath);
	} finally {
		releasePackPipeline(pipeline);
		if (prevView) native.symbols.wgpuTextureViewRelease(asPtr(prevView));
		if (prevTex) native.symbols.wgpuTextureRelease(asPtr(prevTex));
		if (prevSampler) native.symbols.wgpuSamplerRelease(asPtr(prevSampler));
		native.symbols.wgpuTextureViewRelease(asPtr(targetView));
		native.symbols.wgpuTextureRelease(asPtr(targetTex));
	}
}

export type RenderPackToWebPOptions = {
	pack: Pack;
	/** Output image width. Default DEFAULT_RENDER_WIDTH (640). */
	width?: number;
	/** Output image height. Default DEFAULT_RENDER_HEIGHT (480). */
	height?: number;
	/** Total frames to render. Default DEFAULT_RENDER_FRAMES (120). */
	frames?: number;
	/**
	 * How many evenly-spaced frames to capture for the WebP animation.
	 * Default 20 — produces a ~1–2 s animation at the given duration.
	 * Must be <= `frames`.
	 */
	webpFrames?: number;
	/** Duration of each frame in milliseconds. Default 100 (10 fps). */
	duration?: number;
	/** WebP quality (0–100). Default 80. */
	quality?: number;
	/** Where to write the WebP. The directory must already exist. */
	outPath: string;
	/** Override pack parameter values. */
	paramOverrides?: ParamValueMap;
	/** Override synthetic audio features (constant across all frames). */
	audioOverrides?: Partial<AudioFeatures>;
};

/**
 * Render `pack` headlessly for `frames` frames, capture `webpFrames` evenly-
 * spaced snapshots, and assemble an animated WebP written to `outPath`.
 * Uses full 24-bit colour (no palette limitation like GIF).
 */
export async function renderPackToWebP(opts: RenderPackToWebPOptions): Promise<void> {
	const width = opts.width ?? DEFAULT_RENDER_WIDTH;
	const height = opts.height ?? DEFAULT_RENDER_HEIGHT;
	const frames = Math.max(1, opts.frames ?? DEFAULT_RENDER_FRAMES);
	const webpFrameCount = Math.min(opts.webpFrames ?? 20, frames);
	const duration = opts.duration ?? 100;
	const quality = opts.quality ?? 80;
	const dtMs = 1000 / 60;
	const native = WGPU.native;

	// Determine which frame indices to capture (evenly spaced)
	const captureIndices: number[] = [];
	for (let i = 0; i < webpFrameCount; i++) {
		captureIndices.push(Math.round((i * (frames - 1)) / (webpFrameCount - 1)));
	}
	const captureSet = new Set(captureIndices);

	const renderer = createHeadlessRenderer({ width, height });
	const encoderDesc = makeCommandEncoderDescriptor();

	const targetDesc = makeTextureDescriptor(
		width,
		height,
		TextureFormat_BGRA8Unorm,
		TextureUsage_RenderAttachment | TextureUsage_TextureBinding | TextureUsage_CopySrc,
	);
	const targetTex = native.symbols.wgpuDeviceCreateTexture(asPtr(renderer.device), asPtr(targetDesc.ptr)) as number;
	if (!targetTex) throw new Error("failed to create offscreen target texture");
	const targetView = native.symbols.wgpuTextureCreateView(asPtr(targetTex), asPtr(0)) as number;
	if (!targetView) throw new Error("failed to create offscreen target view");

	let prevTex = 0;
	let prevView = 0;
	let prevSampler = 0;
	if (opts.pack.usesPrevFrame) {
		const prevDesc = makeTextureDescriptor(
			width,
			height,
			TextureFormat_BGRA8Unorm,
			TextureUsage_TextureBinding | TextureUsage_CopyDst,
		);
		prevTex = native.symbols.wgpuDeviceCreateTexture(asPtr(renderer.device), asPtr(prevDesc.ptr)) as number;
		if (!prevTex) throw new Error("failed to create prev-frame texture");
		prevView = native.symbols.wgpuTextureCreateView(asPtr(prevTex), asPtr(0)) as number;
		const samplerDesc = makeSamplerDescriptor();
		prevSampler = native.symbols.wgpuDeviceCreateSampler(asPtr(renderer.device), asPtr(samplerDesc.ptr)) as number;
		if (!prevSampler) throw new Error("failed to create prev-frame sampler");
	}

	const pipeline = createPackPipeline({
		renderer,
		shaderText: opts.pack.shaderText,
		uniformBufferSize: UNIFORM_BUFFER_SIZE,
		paramBufferSize:
			opts.pack.parameters.length > 0 ? parameterBufferSize(opts.pack.parameters) : 0,
		usesPrevFrame: opts.pack.usesPrevFrame,
		prevFrameView: prevView,
		prevFrameSampler: prevSampler,
		extraPassShaders: opts.pack.extraPasses,
		chainWidth: width,
		chainHeight: height,
	});

	const uniforms = new UniformWriter({
		bufferSize: UNIFORM_BUFFER_SIZE,
		packOffset: PACK_UNIFORM_OFFSET,
		spectrumBins: SPECTRUM_BINS,
	});
	const synthSpectrum = new Float32Array(SPECTRUM_BINS);
	const paramValues = defaultParameterValues(opts.pack.parameters);
	if (opts.paramOverrides) {
		for (const [k, v] of Object.entries(opts.paramOverrides)) {
			if (k in paramValues) paramValues[k] = v;
		}
	}

	const prevCopySrc = opts.pack.usesPrevFrame ? makeTexelCopyTextureInfo(targetTex) : null;
	const prevCopyDst = opts.pack.usesPrevFrame ? makeTexelCopyTextureInfo(prevTex) : null;
	const prevCopyExtent = opts.pack.usesPrevFrame ? makeExtent3D(width, height, 1) : null;

	const capturedFrames: Uint8Array[] = [];

	try {
		for (let frameIdx = 0; frameIdx < frames; frameIdx++) {
			const elapsedSec = (frameIdx * dtMs) / 1000;
			const features = opts.audioOverrides
				? { ...fakeFeatures(elapsedSec), ...opts.audioOverrides }
				: fakeFeatures(elapsedSec);
			fakeSpectrum(elapsedSec, synthSpectrum);
			const nowMs = frameIdx * dtMs;

			uniforms.fillHost(nowMs, 0, dtMs, { width, height }, features, synthSpectrum);
			uniforms.write(nowMs, 0, opts.pack, pipeline, paramValues, renderer, features);

			native.symbols.wgpuInstanceProcessEvents(asPtr(renderer.instance));

			const encoder = native.symbols.wgpuDeviceCreateCommandEncoder(
				asPtr(renderer.device),
				asPtr(encoderDesc.ptr),
			) as number;
			renderPackPass(encoder, pipeline, targetView);
			if (prevCopySrc && prevCopyDst && prevCopyExtent) {
				native.symbols.wgpuCommandEncoderCopyTextureToTexture(
					asPtr(encoder),
					asPtr(prevCopySrc.ptr),
					asPtr(prevCopyDst.ptr),
					asPtr(prevCopyExtent.ptr),
				);
			}
			const cmd = native.symbols.wgpuCommandEncoderFinish(asPtr(encoder), asPtr(0)) as number;
			const cmdArray = makeCommandBufferArray(cmd);
			native.symbols.wgpuQueueSubmit(asPtr(renderer.queue), 1, asPtr(cmdArray.ptr));
			native.symbols.wgpuCommandBufferRelease(asPtr(cmd));
			native.symbols.wgpuCommandEncoderRelease(asPtr(encoder));

			if (opts.pack.wasmRuntime) await Bun.sleep(8);

			if (captureSet.has(frameIdx)) {
				const rgba = await readbackToRgba(renderer, targetTex, width, height);
				capturedFrames.push(rgba);
			}
		}

		// Assemble animated WebP from captured frames
		const webpFrames = capturedFrames.map((data) => ({
			data,
			duration,
			config: { lossless: 0, quality },
		}));
		const webpData = await encodeAnimation(width, height, true, webpFrames);
		if (!webpData) throw new Error("encodeAnimation returned null");
		writeFileSync(opts.outPath, webpData);
	} finally {
		releasePackPipeline(pipeline);
		if (prevView) native.symbols.wgpuTextureViewRelease(asPtr(prevView));
		if (prevTex) native.symbols.wgpuTextureRelease(asPtr(prevTex));
		if (prevSampler) native.symbols.wgpuSamplerRelease(asPtr(prevSampler));
		native.symbols.wgpuTextureViewRelease(asPtr(targetView));
		native.symbols.wgpuTextureRelease(asPtr(targetTex));
	}
}

/**
 * Read back the contents of `srcTex` as a tightly-packed RGBA Uint8Array.
 */
async function readbackToRgba(
	renderer: { instance: number; device: number; queue: number },
	srcTex: number,
	width: number,
	height: number,
): Promise<Uint8Array> {
	const native = WGPU.native;
	const bytesPerRow = alignTo(width * 4, 256);
	const readbackSize = bytesPerRow * height;
	const readbackDesc = makeBufferDescriptor(
		readbackSize,
		BufferUsage_MapRead | BufferUsage_CopyDst,
	);
	const readback = native.symbols.wgpuDeviceCreateBuffer(
		asPtr(renderer.device),
		asPtr(readbackDesc.ptr),
	) as number;
	if (!readback) throw new Error("failed to create readback buffer");

	try {
		const encoderDesc = makeCommandEncoderDescriptor();
		const copyEncoder = native.symbols.wgpuDeviceCreateCommandEncoder(
			asPtr(renderer.device),
			asPtr(encoderDesc.ptr),
		) as number;
		const copySrcInfo = makeTexelCopyTextureInfo(srcTex);
		const copyDstInfo = makeTexelCopyBufferInfo(readback, bytesPerRow, height);
		const copyExtent = makeExtent3D(width, height, 1);
		native.symbols.wgpuCommandEncoderCopyTextureToBuffer(
			asPtr(copyEncoder),
			asPtr(copySrcInfo.ptr),
			asPtr(copyDstInfo.ptr),
			asPtr(copyExtent.ptr),
		);
		const copyCmd = native.symbols.wgpuCommandEncoderFinish(asPtr(copyEncoder), asPtr(0)) as number;
		const copyCmdArray = makeCommandBufferArray(copyCmd);
		native.symbols.wgpuQueueSubmit(asPtr(renderer.queue), 1, asPtr(copyCmdArray.ptr));
		native.symbols.wgpuCommandBufferRelease(asPtr(copyCmd));
		native.symbols.wgpuCommandEncoderRelease(asPtr(copyEncoder));

		const padded = new Uint8Array(readbackSize);
		const job = WGPUBridge.bufferReadbackBegin(
			readback,
			0n,
			BigInt(readbackSize),
			ptr(padded.buffer),
		);
		if (!job) throw new Error("bufferReadbackBegin returned null");
		let done = false;
		try {
			for (let i = 0; i < READBACK_POLL_ITERATIONS; i++) {
				native.symbols.wgpuInstanceProcessEvents(asPtr(renderer.instance));
				const status = WGPUBridge.bufferReadbackStatus(job);
				if (status > 0) { done = true; break; }
				if (status < 0) throw new Error(`bufferReadbackStatus = ${status}`);
				await Bun.sleep(2);
			}
		} finally {
			WGPUBridge.bufferReadbackFree(job);
		}
		if (!done) throw new Error("buffer readback timed out");

		return stripPaddingToRgba(padded, width, height, bytesPerRow);
	} finally {
		native.symbols.wgpuBufferRelease(asPtr(readback));
	}
}

/**
 * Read back the contents of `srcTex` and encode as a PNG file.
 */
async function readbackAndWritePng(
	renderer: { instance: number; device: number; queue: number },
	srcTex: number,
	width: number,
	height: number,
	outPath: string,
): Promise<void> {
	const rgba = await readbackToRgba(renderer, srcTex, width, height);
	const png = encodeRgbaPng(rgba, width, height);
	writeFileSync(outPath, png);
}

/**
 * Build the output path for a mid-render capture by inserting `suffix`
 * before the file extension.
 * `/tmp/foo.png` + `_frame30` → `/tmp/foo_frame30.png`
 * `/tmp/foo.png` + `_t1.50s` → `/tmp/foo_t1.50s.png`
 */
function captureSuffixPath(basePath: string, suffix: string): string {
	const dot = basePath.lastIndexOf(".");
	if (dot === -1) return `${basePath}${suffix}`;
	return `${basePath.slice(0, dot)}${suffix}${basePath.slice(dot)}`;
}

/**
 * Mirrors `engine/render-frame.ts:renderPackPass` minus the transition-rig
 * dependency. Single-pass packs do one render; multi-pass packs walk the
 * intermediate views and the final pass writes to `finalTargetView`.
 */
function renderPackPass(encoder: number, pp: PackPipeline, finalTargetView: number): void {
	const native = WGPU.native;
	const totalPasses = 1 + pp.extraPasses.length;
	for (let i = 0; i < totalPasses; i++) {
		const isLast = i === totalPasses - 1;
		const targetView = isLast ? finalTargetView : pp.intermediateView[i]!;
		const pipelineHandle = i === 0 ? pp.pipeline : pp.extraPasses[i - 1]!.pipeline;
		const uniformBg = i === 0 ? pp.bindGroup : pp.extraPasses[i - 1]!.uniformBindGroup;
		const paramBg = i === 0 ? pp.paramBindGroup : pp.extraPasses[i - 1]!.paramBindGroup;

		const colorAttachment = makeRenderPassColorAttachment(targetView, [0, 0, 0, 1]);
		const renderPassDesc = makeRenderPassDescriptor(colorAttachment.ptr);
		const pass = native.symbols.wgpuCommandEncoderBeginRenderPass(
			asPtr(encoder),
			asPtr(renderPassDesc.ptr),
		) as number;
		native.symbols.wgpuRenderPassEncoderSetPipeline(asPtr(pass), asPtr(pipelineHandle));
		native.symbols.wgpuRenderPassEncoderSetBindGroup(asPtr(pass), 0, asPtr(uniformBg), 0, asPtr(0));
		if (paramBg) native.symbols.wgpuRenderPassEncoderSetBindGroup(asPtr(pass), 1, asPtr(paramBg), 0, asPtr(0));
		if (i === 0 && pp.prevBindGroup) {
			native.symbols.wgpuRenderPassEncoderSetBindGroup(asPtr(pass), 2, asPtr(pp.prevBindGroup), 0, asPtr(0));
		}
		if (i > 0) {
			native.symbols.wgpuRenderPassEncoderSetBindGroup(
				asPtr(pass),
				3,
				asPtr(pp.extraPasses[i - 1]!.inputBindGroup),
				0,
				asPtr(0),
			);
		}
		native.symbols.wgpuRenderPassEncoderDraw(asPtr(pass), 3, 1, 0, 0);
		native.symbols.wgpuRenderPassEncoderEnd(asPtr(pass));
	}
}

/**
 * wgpu requires `bytesPerRow` to be a multiple of 256, so the readback buffer
 * is row-padded. Strip the padding into a tightly-packed RGBA buffer.
 *
 * Pixels come back already in RGBA byte order: even though `wgpu-helpers.ts`
 * names the format `TextureFormat_BGRA8Unorm` with value `0x17`, that value in
 * the bundled Dawn build is actually RGBA8Unorm, so no swizzle is needed. The
 * existing in-app rendering doesn't see this because pack pipelines target
 * `renderer.surfaceFormat` probed from the live surface at runtime.
 */
function stripPaddingToRgba(
	padded: Uint8Array,
	width: number,
	height: number,
	bytesPerRow: number,
): Uint8Array {
	const rgba = new Uint8Array(width * height * 4);
	const tightStride = width * 4;
	for (let y = 0; y < height; y++) {
		rgba.set(
			padded.subarray(y * bytesPerRow, y * bytesPerRow + tightStride),
			y * tightStride,
		);
	}
	return rgba;
}

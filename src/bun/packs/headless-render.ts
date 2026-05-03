import { ptr } from "bun:ffi";
import { writeFileSync } from "fs";
import { WGPU, WGPUBridge } from "electrobun/bun";

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
import { encodeRgbaPng } from "./png-encode";
import type { Pack } from "./loader";

const SPECTRUM_BINS = 32;
const UNIFORM_BUFFER_SIZE = 16384;
const PACK_UNIFORM_OFFSET = 176;

/** Max iterations of the wgpu-event poll loop before giving up on a readback. */
const READBACK_POLL_ITERATIONS = 1000;

export type RenderPackToPngOptions = {
	pack: Pack;
	/** Output image width. Default 1024. */
	width?: number;
	/** Output image height. Default 768. */
	height?: number;
	/** Frames to render before capturing the last one. Default 120 (2 s @ 60fps). */
	frames?: number;
	/** Where to write the PNG. The directory must already exist. */
	outPath: string;
};

/**
 * Render `pack` for `frames` frames headlessly (no window, no audio capture)
 * and write the final frame to `outPath` as a PNG. Audio features are filled
 * with the same deterministic synthetic curves the live preview uses when no
 * capture is running, so output is reproducible across runs.
 */
export async function renderPackToPng(opts: RenderPackToPngOptions): Promise<void> {
	const width = opts.width ?? 1024;
	const height = opts.height ?? 768;
	const frames = Math.max(1, opts.frames ?? 120);
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
	const targetTex = native.symbols.wgpuDeviceCreateTexture(renderer.device, targetDesc.ptr) as number;
	if (!targetTex) throw new Error("failed to create offscreen target texture");
	const targetView = native.symbols.wgpuTextureCreateView(targetTex, 0) as number;
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
		prevTex = native.symbols.wgpuDeviceCreateTexture(renderer.device, prevDesc.ptr) as number;
		if (!prevTex) throw new Error("failed to create prev-frame texture");
		prevView = native.symbols.wgpuTextureCreateView(prevTex, 0) as number;
		const samplerDesc = makeSamplerDescriptor();
		prevSampler = native.symbols.wgpuDeviceCreateSampler(renderer.device, samplerDesc.ptr) as number;
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

	const prevCopySrc = opts.pack.usesPrevFrame ? makeTexelCopyTextureInfo(targetTex) : null;
	const prevCopyDst = opts.pack.usesPrevFrame ? makeTexelCopyTextureInfo(prevTex) : null;
	const prevCopyExtent = opts.pack.usesPrevFrame ? makeExtent3D(width, height, 1) : null;

	try {
		for (let frameIdx = 0; frameIdx < frames; frameIdx++) {
			const elapsedSec = (frameIdx * dtMs) / 1000;
			const features = fakeFeatures(elapsedSec);
			fakeSpectrum(elapsedSec, synthSpectrum);
			const nowMs = frameIdx * dtMs;

			uniforms.fillHost(nowMs, 0, dtMs, { width, height }, features, synthSpectrum);
			uniforms.write(nowMs, 0, opts.pack, pipeline, paramValues, renderer, features);

			native.symbols.wgpuInstanceProcessEvents(renderer.instance);

			const encoder = native.symbols.wgpuDeviceCreateCommandEncoder(
				renderer.device,
				encoderDesc.ptr,
			) as number;
			renderPackPass(encoder, pipeline, targetView);
			if (prevCopySrc && prevCopyDst && prevCopyExtent) {
				native.symbols.wgpuCommandEncoderCopyTextureToTexture(
					encoder,
					prevCopySrc.ptr,
					prevCopyDst.ptr,
					prevCopyExtent.ptr,
				);
			}
			const cmd = native.symbols.wgpuCommandEncoderFinish(encoder, 0) as number;
			const cmdArray = makeCommandBufferArray(cmd);
			native.symbols.wgpuQueueSubmit(renderer.queue, 1, cmdArray.ptr);
			native.symbols.wgpuCommandBufferRelease(cmd);
			native.symbols.wgpuCommandEncoderRelease(encoder);

			// WASM packs run their viz_frame on a worker; sleeping for ~one frame
			// keeps framesPending under the deadline (see runtime.ts:128).
			if (opts.pack.wasmRuntime) await Bun.sleep(8);
		}

		const bytesPerRow = alignTo(width * 4, 256);
		const readbackSize = bytesPerRow * height;
		const readbackDesc = makeBufferDescriptor(
			readbackSize,
			BufferUsage_MapRead | BufferUsage_CopyDst,
		);
		const readback = native.symbols.wgpuDeviceCreateBuffer(
			renderer.device,
			readbackDesc.ptr,
		) as number;
		if (!readback) throw new Error("failed to create readback buffer");

		try {
			const copyEncoder = native.symbols.wgpuDeviceCreateCommandEncoder(
				renderer.device,
				encoderDesc.ptr,
			) as number;
			const copySrcInfo = makeTexelCopyTextureInfo(targetTex);
			const copyDstInfo = makeTexelCopyBufferInfo(readback, bytesPerRow, height);
			const copyExtent = makeExtent3D(width, height, 1);
			native.symbols.wgpuCommandEncoderCopyTextureToBuffer(
				copyEncoder,
				copySrcInfo.ptr,
				copyDstInfo.ptr,
				copyExtent.ptr,
			);
			const copyCmd = native.symbols.wgpuCommandEncoderFinish(copyEncoder, 0) as number;
			const copyCmdArray = makeCommandBufferArray(copyCmd);
			native.symbols.wgpuQueueSubmit(renderer.queue, 1, copyCmdArray.ptr);
			native.symbols.wgpuCommandBufferRelease(copyCmd);
			native.symbols.wgpuCommandEncoderRelease(copyEncoder);

			const padded = new Uint8Array(readbackSize);
			const job = WGPUBridge.bufferReadbackBegin(
				readback as any,
				0n,
				BigInt(readbackSize),
				ptr(padded.buffer) as any,
			);
			if (!job) throw new Error("bufferReadbackBegin returned null");
			let done = false;
			try {
				for (let i = 0; i < READBACK_POLL_ITERATIONS; i++) {
					native.symbols.wgpuInstanceProcessEvents(renderer.instance);
					const status = WGPUBridge.bufferReadbackStatus(job as any);
					if (status > 0) { done = true; break; }
					if (status < 0) throw new Error(`bufferReadbackStatus = ${status}`);
					await Bun.sleep(2);
				}
			} finally {
				WGPUBridge.bufferReadbackFree(job as any);
			}
			if (!done) throw new Error("buffer readback timed out");

			const rgba = stripPaddingToRgba(padded, width, height, bytesPerRow);
			const png = encodeRgbaPng(rgba, width, height);
			writeFileSync(opts.outPath, png);
		} finally {
			native.symbols.wgpuBufferRelease(readback);
		}
	} finally {
		releasePackPipeline(pipeline);
		if (prevView) native.symbols.wgpuTextureViewRelease(prevView);
		if (prevTex) native.symbols.wgpuTextureRelease(prevTex);
		if (prevSampler) native.symbols.wgpuSamplerRelease(prevSampler);
		native.symbols.wgpuTextureViewRelease(targetView);
		native.symbols.wgpuTextureRelease(targetTex);
	}
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
			encoder,
			renderPassDesc.ptr,
		) as number;
		native.symbols.wgpuRenderPassEncoderSetPipeline(pass, pipelineHandle);
		native.symbols.wgpuRenderPassEncoderSetBindGroup(pass, 0, uniformBg, 0, 0);
		if (paramBg) native.symbols.wgpuRenderPassEncoderSetBindGroup(pass, 1, paramBg, 0, 0);
		if (i === 0 && pp.prevBindGroup) {
			native.symbols.wgpuRenderPassEncoderSetBindGroup(pass, 2, pp.prevBindGroup, 0, 0);
		}
		if (i > 0) {
			native.symbols.wgpuRenderPassEncoderSetBindGroup(
				pass,
				3,
				pp.extraPasses[i - 1]!.inputBindGroup,
				0,
				0,
			);
		}
		native.symbols.wgpuRenderPassEncoderDraw(pass, 3, 1, 0, 0);
		native.symbols.wgpuRenderPassEncoderEnd(pass);
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

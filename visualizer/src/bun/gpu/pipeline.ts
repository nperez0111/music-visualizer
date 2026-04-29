import { CString, ptr } from "bun:ffi";
import { WGPU } from "electrobun/bun";
import {
	BufferUsage_CopyDst,
	BufferUsage_Uniform,
	makeBindGroupDescriptor,
	makeBindGroupEntries,
	makeBindGroupEntryBuffer,
	makeBindGroupEntrySampler,
	makeBindGroupEntryTexture,
	makeBufferDescriptor,
	makeColorTargetState,
	makeFragmentState,
	makeMultisampleState,
	makePrimitiveState,
	makeRenderPipelineDescriptor,
	makeSamplerDescriptor,
	makeShaderModuleDescriptor,
	makeShaderSourceWGSL,
	makeTextureDescriptor,
	makeVertexState,
	TextureUsage_RenderAttachment,
	TextureUsage_TextureBinding,
} from "./wgpu-helpers";
import type { Renderer } from "./renderer";

/** A single post-FX pass attached to a PackPipeline. Pass index `i` reads from
 * the previous pass's intermediate texture via @group(3). */
export type ExtraPass = {
	pipeline: number;
	shaderModule: number;
	uniformBindGroup: number;
	paramBindGroup: number;
	inputBindGroup: number;
	inputBindLayout: number;
};

export type PackPipeline = {
	pipeline: number;
	bindGroup: number;
	shaderModule: number;
	uniformBuffer: number;
	uniformBufferSize: number;
	/** Optional parameter buffer (pack-declared @group(1) @binding(0)). */
	paramBuffer: number;
	paramBufferSize: number;
	paramBindGroup: number;
	/** Prev-frame bind group (group 2). Non-zero only for packs that opt in. Rebuilt on resize. */
	prevBindGroup: number;
	prevBindLayout: number;
	prevGeneration: number;
	/** Empty for single-pass packs. Order matches manifest. */
	extraPasses: ExtraPass[];
	/** Intermediate render targets. `intermediateView[i]` receives pass `i`'s output. */
	intermediateTex: number[];
	intermediateView: number[];
	/** Shared sampler used by every extra-pass input binding. */
	interSampler: number;
	chainWidth: number;
	chainHeight: number;
	keepalive: any[];
};

/**
 * Builds a fullscreen-triangle pipeline for one pack's WGSL plus its own
 * uniform buffer (and an optional parameter buffer if `paramBufferSize > 0`).
 * If `extraPassShaders` is non-empty, also builds a chain of post-FX passes
 * with intermediate render targets sized to `chainWidth` × `chainHeight`.
 *
 * Each pack owns its buffers so per-pack data (e.g. the Tier-2 WASM custom
 * region or live parameter values) doesn't leak across packs during
 * crossfades.
 */
export function createPackPipeline(opts: {
	renderer: Renderer;
	shaderText: string;
	uniformBufferSize: number;
	paramBufferSize?: number;
	targetFormat?: number;
	usesPrevFrame?: boolean;
	prevFrameView?: number;
	prevFrameSampler?: number;
	prevGeneration?: number;
	extraPassShaders?: Array<{ shaderText: string }>;
	chainWidth?: number;
	chainHeight?: number;
}): PackPipeline {
	const { renderer, shaderText, uniformBufferSize } = opts;
	const paramBufferSize = opts.paramBufferSize ?? 0;
	const targetFormat = opts.targetFormat ?? renderer.surfaceFormat;
	const usesPrevFrame = opts.usesPrevFrame ?? false;
	const extraPassShaders = opts.extraPassShaders ?? [];
	const chainWidth = Math.max(1, opts.chainWidth ?? 1);
	const chainHeight = Math.max(1, opts.chainHeight ?? 1);
	const native = WGPU.native;
	const keepalive: any[] = [];

	const uniformBufferDesc = makeBufferDescriptor(
		uniformBufferSize,
		BufferUsage_Uniform | BufferUsage_CopyDst,
	);
	keepalive.push(uniformBufferDesc.buffer);
	const uniformBuffer = native.symbols.wgpuDeviceCreateBuffer(
		renderer.device,
		uniformBufferDesc.ptr,
	) as number;
	if (!uniformBuffer) throw new Error("Failed to create per-pack uniform buffer");

	let paramBuffer = 0;
	if (paramBufferSize > 0) {
		const paramBufDesc = makeBufferDescriptor(
			paramBufferSize,
			BufferUsage_Uniform | BufferUsage_CopyDst,
		);
		keepalive.push(paramBufDesc.buffer);
		paramBuffer = native.symbols.wgpuDeviceCreateBuffer(
			renderer.device,
			paramBufDesc.ptr,
		) as number;
		if (!paramBuffer) throw new Error("failed to create per-pack parameter buffer");
	}

	function buildPipeline(text: string): { pipeline: number; shaderModule: number } {
		const shaderBytes = new TextEncoder().encode(text + "\0");
		keepalive.push(shaderBytes);
		const shaderSource = makeShaderSourceWGSL(ptr(shaderBytes) as number);
		const shaderModuleDesc = makeShaderModuleDescriptor(shaderSource.ptr);
		keepalive.push(shaderSource.buffer, shaderModuleDesc.buffer);
		const shaderModule = native.symbols.wgpuDeviceCreateShaderModule(
			renderer.device,
			shaderModuleDesc.ptr,
		) as number;
		if (!shaderModule) throw new Error("Failed to create shader module");

		const vsEntry = new CString("vs_main");
		const fsEntry = new CString("fs_main");
		keepalive.push(vsEntry, fsEntry);

		const vertexState = makeVertexState(shaderModule, vsEntry.ptr as number, 0, 0);
		const colorTarget = makeColorTargetState(targetFormat);
		const fragmentState = makeFragmentState(shaderModule, fsEntry.ptr as number, colorTarget.ptr);
		const primitiveState = makePrimitiveState();
		const multisampleState = makeMultisampleState();
		keepalive.push(
			vertexState.buffer,
			colorTarget.buffer,
			fragmentState.buffer,
			primitiveState.buffer,
			multisampleState.buffer,
		);

		const pipelineDesc = makeRenderPipelineDescriptor(
			vertexState,
			primitiveState,
			multisampleState,
			fragmentState.ptr,
		);
		keepalive.push(pipelineDesc.buffer);
		const pipeline = native.symbols.wgpuDeviceCreateRenderPipeline(
			renderer.device,
			pipelineDesc.ptr,
		) as number;
		if (!pipeline) throw new Error("Failed to create render pipeline");
		return { pipeline, shaderModule };
	}

	function buildUniformBindGroup(pipeline: number): number {
		const bindGroupLayout = native.symbols.wgpuRenderPipelineGetBindGroupLayout(
			pipeline,
			0,
		) as number;
		const entries = makeBindGroupEntries([
			makeBindGroupEntryBuffer(0, uniformBuffer, 0, uniformBufferSize),
		]);
		const desc = makeBindGroupDescriptor(bindGroupLayout, entries.ptr, 1);
		keepalive.push(entries.buffer, desc.buffer);
		const bg = native.symbols.wgpuDeviceCreateBindGroup(renderer.device, desc.ptr) as number;
		if (!bg) throw new Error("Failed to create uniform bind group");
		return bg;
	}

	function buildParamBindGroup(pipeline: number): number {
		if (paramBufferSize <= 0 || !paramBuffer) return 0;
		const layout = native.symbols.wgpuRenderPipelineGetBindGroupLayout(
			pipeline,
			1,
		) as number;
		if (!layout) throw new Error("pack declares parameters but shader has no @group(1) binding");
		const entries = makeBindGroupEntries([
			makeBindGroupEntryBuffer(0, paramBuffer, 0, paramBufferSize),
		]);
		const desc = makeBindGroupDescriptor(layout, entries.ptr, 1);
		keepalive.push(entries.buffer, desc.buffer);
		const bg = native.symbols.wgpuDeviceCreateBindGroup(renderer.device, desc.ptr) as number;
		if (!bg) throw new Error("failed to create parameter bind group");
		return bg;
	}

	// ---------- Pass 0: main shader ----------
	const main = buildPipeline(shaderText);
	const pipeline = main.pipeline;
	const shaderModule = main.shaderModule;
	const bindGroup = buildUniformBindGroup(pipeline);
	const paramBindGroup = buildParamBindGroup(pipeline);

	let prevBindGroup = 0;
	let prevBindLayout = 0;
	if (usesPrevFrame) {
		if (!opts.prevFrameView || !opts.prevFrameSampler) {
			throw new Error("pack uses prev-frame but host did not supply view/sampler");
		}
		prevBindLayout = native.symbols.wgpuRenderPipelineGetBindGroupLayout(
			pipeline,
			2,
		) as number;
		if (!prevBindLayout)
			throw new Error("pack opts into prev-frame but shader has no @group(2) binding");
		const prevEntries = makeBindGroupEntries([
			makeBindGroupEntrySampler(0, opts.prevFrameSampler),
			makeBindGroupEntryTexture(1, opts.prevFrameView),
		]);
		const prevBindDesc = makeBindGroupDescriptor(prevBindLayout, prevEntries.ptr, 2);
		keepalive.push(prevEntries.buffer, prevBindDesc.buffer);
		prevBindGroup = native.symbols.wgpuDeviceCreateBindGroup(
			renderer.device,
			prevBindDesc.ptr,
		) as number;
		if (!prevBindGroup) throw new Error("failed to create prev-frame bind group");
	}

	// ---------- Multi-pass chain ----------
	const intermediateTex: number[] = [];
	const intermediateView: number[] = [];
	let interSampler = 0;
	const extraPasses: ExtraPass[] = [];

	if (extraPassShaders.length > 0) {
		const samplerDesc = makeSamplerDescriptor();
		keepalive.push(samplerDesc.buffer);
		interSampler = native.symbols.wgpuDeviceCreateSampler(
			renderer.device,
			samplerDesc.ptr,
		) as number;
		if (!interSampler) throw new Error("failed to create inter-pass sampler");

		// Allocate one intermediate per extra pass (= pass count - 1; equals
		// extraPassShaders.length because main is pass 0).
		const interUsage = TextureUsage_RenderAttachment | TextureUsage_TextureBinding;
		for (let i = 0; i < extraPassShaders.length; i++) {
			const desc = makeTextureDescriptor(chainWidth, chainHeight, targetFormat, interUsage);
			keepalive.push(desc.buffer);
			const tex = native.symbols.wgpuDeviceCreateTexture(renderer.device, desc.ptr) as number;
			if (!tex) throw new Error("failed to create intermediate texture");
			const view = native.symbols.wgpuTextureCreateView(tex, 0) as number;
			if (!view) throw new Error("failed to create intermediate texture view");
			intermediateTex.push(tex);
			intermediateView.push(view);
		}

		// Build each extra pass: pipeline + bind groups. Pass i (1-indexed in
		// the full chain, 0-indexed within extraPassShaders) reads
		// intermediateView[i-1] via @group(3).
		// In our 0-indexed array of extras: extras[k] reads intermediate[k]
		// (pass 0 wrote to intermediate[0], extras[0] is "pass 1"). Correct.
		for (let k = 0; k < extraPassShaders.length; k++) {
			const shaderText = extraPassShaders[k]!.shaderText;
			const pl = buildPipeline(shaderText);
			const uniformBg = buildUniformBindGroup(pl.pipeline);
			const paramBg = buildParamBindGroup(pl.pipeline);

			const inputLayout = native.symbols.wgpuRenderPipelineGetBindGroupLayout(
				pl.pipeline,
				3,
			) as number;
			if (!inputLayout)
				throw new Error(`extra pass ${k} shader has no @group(3) binding`);
			const inputEntries = makeBindGroupEntries([
				makeBindGroupEntrySampler(0, interSampler),
				makeBindGroupEntryTexture(1, intermediateView[k]!),
			]);
			const inputDesc = makeBindGroupDescriptor(inputLayout, inputEntries.ptr, 2);
			keepalive.push(inputEntries.buffer, inputDesc.buffer);
			const inputBg = native.symbols.wgpuDeviceCreateBindGroup(
				renderer.device,
				inputDesc.ptr,
			) as number;
			if (!inputBg) throw new Error(`failed to create extra-pass ${k} input bind group`);

			extraPasses.push({
				pipeline: pl.pipeline,
				shaderModule: pl.shaderModule,
				uniformBindGroup: uniformBg,
				paramBindGroup: paramBg,
				inputBindGroup: inputBg,
				inputBindLayout: inputLayout,
			});
		}
	}

	return {
		pipeline,
		bindGroup,
		shaderModule,
		uniformBuffer,
		uniformBufferSize,
		paramBuffer,
		paramBufferSize,
		paramBindGroup,
		prevBindGroup,
		prevBindLayout,
		prevGeneration: opts.prevGeneration ?? 0,
		extraPasses,
		intermediateTex,
		intermediateView,
		interSampler,
		chainWidth,
		chainHeight,
		keepalive,
	};
}

/**
 * Best-effort release of every GPU resource owned by a pack pipeline. Used
 * by both dev-mode hot-reload and the runtime LRU cache eviction. Errors
 * from individual release calls are swallowed — wgpu-native is forgiving and
 * we don't want one stale handle to abort the rest of the cleanup.
 */
export function releasePackPipeline(pp: PackPipeline): void {
	const native = WGPU.native;
	const tryRelease = (fn: (h: number) => void, h: number) => {
		if (!h) return;
		try { fn(h); } catch {}
	};
	tryRelease(native.symbols.wgpuBindGroupRelease, pp.bindGroup);
	tryRelease(native.symbols.wgpuBindGroupRelease, pp.paramBindGroup);
	tryRelease(native.symbols.wgpuBindGroupRelease, pp.prevBindGroup);
	tryRelease(native.symbols.wgpuBufferRelease, pp.uniformBuffer);
	tryRelease(native.symbols.wgpuBufferRelease, pp.paramBuffer);
	tryRelease(native.symbols.wgpuRenderPipelineRelease, pp.pipeline);
	tryRelease(native.symbols.wgpuShaderModuleRelease, pp.shaderModule);
	for (const ep of pp.extraPasses) {
		tryRelease(native.symbols.wgpuBindGroupRelease, ep.uniformBindGroup);
		tryRelease(native.symbols.wgpuBindGroupRelease, ep.paramBindGroup);
		tryRelease(native.symbols.wgpuBindGroupRelease, ep.inputBindGroup);
		tryRelease(native.symbols.wgpuRenderPipelineRelease, ep.pipeline);
		tryRelease(native.symbols.wgpuShaderModuleRelease, ep.shaderModule);
	}
	for (const v of pp.intermediateView) tryRelease(native.symbols.wgpuTextureViewRelease, v);
	for (const t of pp.intermediateTex) tryRelease(native.symbols.wgpuTextureRelease, t);
	tryRelease(native.symbols.wgpuSamplerRelease, pp.interSampler);
}

/**
 * Rebuild the prev-frame bind group when the prev texture is reallocated
 * (e.g. on window resize). Reuses the pipeline's stored layout. No-op for
 * packs that don't use prev-frame.
 */
export function rebuildPackPrevBindGroup(
	pp: PackPipeline,
	renderer: Renderer,
	prevFrameView: number,
	prevFrameSampler: number,
	generation: number,
): void {
	if (!pp.prevBindLayout) return;
	if (pp.prevGeneration === generation && pp.prevBindGroup) return;
	const native = WGPU.native;
	const prevEntries = makeBindGroupEntries([
		makeBindGroupEntrySampler(0, prevFrameSampler),
		makeBindGroupEntryTexture(1, prevFrameView),
	]);
	const prevBindDesc = makeBindGroupDescriptor(pp.prevBindLayout, prevEntries.ptr, 2);
	pp.keepalive.push(prevEntries.buffer, prevBindDesc.buffer);
	const bg = native.symbols.wgpuDeviceCreateBindGroup(
		renderer.device,
		prevBindDesc.ptr,
	) as number;
	if (!bg) throw new Error("failed to rebuild prev-frame bind group");
	pp.prevBindGroup = bg;
	pp.prevGeneration = generation;
}

/**
 * Resize the multi-pass intermediate textures and rebuild each extra pass's
 * input bind group against the new views. No-op for single-pass packs and for
 * pipelines whose chain size already matches.
 */
export function rebuildPackChain(
	pp: PackPipeline,
	renderer: Renderer,
	width: number,
	height: number,
): void {
	if (pp.extraPasses.length === 0) return;
	if (pp.chainWidth === width && pp.chainHeight === height) return;
	const native = WGPU.native;

	// Release old textures/views before reallocating.
	for (const v of pp.intermediateView) {
		try { native.symbols.wgpuTextureViewRelease(v); } catch {}
	}
	for (const t of pp.intermediateTex) {
		try { native.symbols.wgpuTextureRelease(t); } catch {}
	}
	pp.intermediateView.length = 0;
	pp.intermediateTex.length = 0;

	const interUsage = TextureUsage_RenderAttachment | TextureUsage_TextureBinding;
	for (let i = 0; i < pp.extraPasses.length; i++) {
		const desc = makeTextureDescriptor(width, height, renderer.surfaceFormat, interUsage);
		pp.keepalive.push(desc.buffer);
		const tex = native.symbols.wgpuDeviceCreateTexture(renderer.device, desc.ptr) as number;
		if (!tex) throw new Error("failed to reallocate intermediate texture");
		const view = native.symbols.wgpuTextureCreateView(tex, 0) as number;
		if (!view) throw new Error("failed to create intermediate texture view");
		pp.intermediateTex.push(tex);
		pp.intermediateView.push(view);
	}

	// Rebuild input bind groups (each extras[k] reads intermediate[k]).
	for (let k = 0; k < pp.extraPasses.length; k++) {
		const ep = pp.extraPasses[k]!;
		const oldBg = ep.inputBindGroup;
		const entries = makeBindGroupEntries([
			makeBindGroupEntrySampler(0, pp.interSampler),
			makeBindGroupEntryTexture(1, pp.intermediateView[k]!),
		]);
		const desc = makeBindGroupDescriptor(ep.inputBindLayout, entries.ptr, 2);
		pp.keepalive.push(entries.buffer, desc.buffer);
		const bg = native.symbols.wgpuDeviceCreateBindGroup(renderer.device, desc.ptr) as number;
		if (!bg) throw new Error(`failed to rebuild input bind group for pass ${k}`);
		ep.inputBindGroup = bg;
		try { native.symbols.wgpuBindGroupRelease(oldBg); } catch {}
	}

	pp.chainWidth = width;
	pp.chainHeight = height;
}

import { CString, ptr, type Pointer } from "bun:ffi";
import { WGPU, asPtr } from "./electrobun-gpu";
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
	makeExtent3D,
	makeFragmentState,
	makeMultisampleState,
	makePrimitiveState,
	makeRenderPassColorAttachment,
	makeRenderPassDescriptor,
	makeRenderPipelineDescriptor,
	makeSamplerDescriptor,
	makeShaderModuleDescriptor,
	makeShaderSourceWGSL,
	makeTexelCopyTextureInfo,
	makeTextureDescriptor,
	makeVertexState,
	TextureUsage_CopyDst,
	TextureUsage_CopySrc,
	TextureUsage_RenderAttachment,
	TextureUsage_TextureBinding,
} from "./wgpu-helpers";
import type { Renderer } from "./renderer";

export type TransitionVariant =
	| "crossfade"
	| "wipe"
	| "radial-burst"
	| "pixelate"
	| "glitch-slice";

export const TRANSITION_VARIANTS: TransitionVariant[] = [
	"crossfade",
	"wipe",
	"radial-burst",
	"pixelate",
	"glitch-slice",
];

const COMMON_WGSL = `
struct CompositeUniforms {
  mix       : f32,
  _pad      : f32,
  resolution: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: CompositeUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var texA: texture_2d<f32>;
@group(0) @binding(3) var texB: texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn hash(p: f32) -> f32 {
  return fract(sin(p * 123.456) * 9876.543);
}
`;

const FS_VARIANTS: Record<TransitionVariant, string> = {
	crossfade: `
@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag_pos.xy / u.resolution;
  let a = textureSample(texA, samp, uv);
  let b = textureSample(texB, samp, uv);
  let m = smoothstep(0.0, 1.0, u.mix);
  return mix(a, b, m);
}
`,
	wipe: `
@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag_pos.xy / u.resolution;
  let a = textureSample(texA, samp, uv);
  let b = textureSample(texB, samp, uv);
  let edge = 0.06;
  let mask = 1.0 - smoothstep(u.mix - edge, u.mix + edge, uv.x);
  return mix(a, b, mask);
}
`,
	"radial-burst": `
@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag_pos.xy / u.resolution;
  let a = textureSample(texA, samp, uv);
  let b = textureSample(texB, samp, uv);
  let aspect = u.resolution.x / u.resolution.y;
  let centered = vec2<f32>((uv.x - 0.5) * aspect, uv.y - 0.5);
  let dist = length(centered);
  let edge = 0.06;
  let radius = u.mix * 1.2;
  let mask = 1.0 - smoothstep(radius - edge, radius + edge, dist);
  return mix(a, b, mask);
}
`,
	pixelate: `
@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag_pos.xy / u.resolution;
  let chunk = max(sin(u.mix * 3.14159) * 0.06, 0.001);
  let qUv = vec2<f32>(floor(uv.x / chunk) * chunk + chunk * 0.5,
                      floor(uv.y / chunk) * chunk + chunk * 0.5);
  let aQ = textureSample(texA, samp, qUv);
  let bQ = textureSample(texB, samp, qUv);
  let m = smoothstep(0.0, 1.0, u.mix);
  return mix(aQ, bQ, m);
}
`,
	"glitch-slice": `
@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag_pos.xy / u.resolution;
  let stripes = 24.0;
  let stripeId = floor(uv.y * stripes);
  let stripeT = hash(stripeId);
  let edge = 0.04;
  let mask = smoothstep(stripeT - edge, stripeT + edge, u.mix);
  // Horizontal jitter on the edge band of each transitioning stripe.
  let edgeBand = mask * (1.0 - smoothstep(stripeT + edge, stripeT + edge + 0.18, u.mix));
  let jitter = (hash(stripeId * 2.7 + floor(u.mix * 32.0)) - 0.5) * 0.12 * edgeBand;
  let aS = textureSample(texA, samp, vec2<f32>(uv.x + jitter, uv.y));
  let bS = textureSample(texB, samp, vec2<f32>(uv.x + jitter, uv.y));
  return mix(aS, bS, mask);
}
`,
};

export function pickRandomTransitionVariant(): TransitionVariant {
	return TRANSITION_VARIANTS[Math.floor(Math.random() * TRANSITION_VARIANTS.length)]!;
}

export type TransitionRig = {
	width: number;
	height: number;
	setSize(width: number, height: number): void;
	targetAView(): number;
	targetBView(): number;
	composite(encoder: number, swapView: number, mix: number, variant: TransitionVariant): void;
	targetFormat: number;
	/** Sampler bound by packs that opt into prev-frame feedback. */
	prevSampler(): number;
	/** Texture view of the previous frame's targetA. Stable per-resize. */
	prevView(): number;
	/** Copy targetA into the prev-frame texture. Call once per frame after rendering. */
	copyTargetAToPrev(encoder: number): void;
	/** Generation counter that bumps on every resize, so callers can rebuild bind groups. */
	prevGeneration(): number;
};

export function createTransitionRig(renderer: Renderer): TransitionRig {
	const native = WGPU.native;
	const keepalive: any[] = [];
	const targetFormat = renderer.surfaceFormat;

	// ----- Composite uniform buffer (16 bytes) -----
	const UNIFORM_SIZE = 16;
	const compositeUboDesc = makeBufferDescriptor(
		UNIFORM_SIZE,
		BufferUsage_Uniform | BufferUsage_CopyDst,
	);
	keepalive.push(compositeUboDesc.buffer);
	const compositeUbo = native.symbols.wgpuDeviceCreateBuffer(
		asPtr(renderer.device),
		asPtr(compositeUboDesc.ptr),
	) as number;
	if (!compositeUbo) throw new Error("failed to create composite UBO");

	// ----- Sampler -----
	const samplerDesc = makeSamplerDescriptor();
	keepalive.push(samplerDesc.buffer);
	const sampler = native.symbols.wgpuDeviceCreateSampler(
		asPtr(renderer.device),
		asPtr(samplerDesc.ptr),
	) as number;
	if (!sampler) throw new Error("failed to create composite sampler");

	// ----- One pipeline per transition variant. Each pipeline created with a
	// default (implicit) layout owns a unique BindGroupLayout, so we also
	// build one bind group per variant against that pipeline's own layout.
	const variantPipelines: Record<TransitionVariant, number> = {} as any;
	const variantLayouts: Record<TransitionVariant, number> = {} as any;

	for (const variant of TRANSITION_VARIANTS) {
		const wgsl = COMMON_WGSL + FS_VARIANTS[variant];
		const shaderBytes = new TextEncoder().encode(wgsl + "\0");
		keepalive.push(shaderBytes);
		const shaderSource = makeShaderSourceWGSL(ptr(shaderBytes) as number);
		const shaderModuleDesc = makeShaderModuleDescriptor(shaderSource.ptr);
		keepalive.push(shaderSource.buffer, shaderModuleDesc.buffer);
		const shaderModule = native.symbols.wgpuDeviceCreateShaderModule(
			asPtr(renderer.device),
			asPtr(shaderModuleDesc.ptr),
		) as number;
		if (!shaderModule) throw new Error(`failed to create transition "${variant}" shader module`);

		const vsEntry = new CString("vs_main" as unknown as Pointer);
		const fsEntry = new CString("fs_main" as unknown as Pointer);
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
			asPtr(renderer.device),
			asPtr(pipelineDesc.ptr),
		) as number;
		if (!pipeline) throw new Error(`failed to create transition "${variant}" pipeline`);
		variantPipelines[variant] = pipeline;
		variantLayouts[variant] = native.symbols.wgpuRenderPipelineGetBindGroupLayout(
			asPtr(pipeline),
			0,
		) as number;
	}

	// ----- Prev-frame sampler (used by packs that opt into @group(2) feedback) -----
	const prevSamplerDesc = makeSamplerDescriptor();
	keepalive.push(prevSamplerDesc.buffer);
	const prevFrameSampler = native.symbols.wgpuDeviceCreateSampler(
		asPtr(renderer.device),
		asPtr(prevSamplerDesc.ptr),
	) as number;
	if (!prevFrameSampler) throw new Error("failed to create prev-frame sampler");

	// ----- Mutable target state -----
	let width = 0;
	let height = 0;
	let texA = 0;
	let texB = 0;
	let viewA = 0;
	let viewB = 0;
	let prevTex = 0;
	let prevTexView = 0;
	let prevGen = 0;
	let copySrc: ReturnType<typeof makeTexelCopyTextureInfo> | null = null;
	let copyDst: ReturnType<typeof makeTexelCopyTextureInfo> | null = null;
	let copyExtent: ReturnType<typeof makeExtent3D> | null = null;
	const variantBindGroups: Record<TransitionVariant, number> = {} as any;
	const bindKeepalive: any[] = [];

	function releaseTargets() {
		if (viewA) native.symbols.wgpuTextureViewRelease(asPtr(viewA));
		if (viewB) native.symbols.wgpuTextureViewRelease(asPtr(viewB));
		if (prevTexView) native.symbols.wgpuTextureViewRelease(asPtr(prevTexView));
		if (texA) native.symbols.wgpuTextureRelease(asPtr(texA));
		if (texB) native.symbols.wgpuTextureRelease(asPtr(texB));
		if (prevTex) native.symbols.wgpuTextureRelease(asPtr(prevTex));
		viewA = viewB = texA = texB = 0;
		prevTex = prevTexView = 0;
		copySrc = copyDst = copyExtent = null;
		for (const v of TRANSITION_VARIANTS) variantBindGroups[v] = 0;
		bindKeepalive.length = 0;
	}

	function rebuildTargets(w: number, h: number) {
		releaseTargets();
		const usageA =
			TextureUsage_RenderAttachment | TextureUsage_TextureBinding | TextureUsage_CopySrc;
		const usageB = TextureUsage_RenderAttachment | TextureUsage_TextureBinding;
		const usagePrev = TextureUsage_TextureBinding | TextureUsage_CopyDst;
		const descA = makeTextureDescriptor(w, h, targetFormat, usageA);
		const descB = makeTextureDescriptor(w, h, targetFormat, usageB);
		const descPrev = makeTextureDescriptor(w, h, targetFormat, usagePrev);
		bindKeepalive.push(descA.buffer, descB.buffer, descPrev.buffer);
		texA = native.symbols.wgpuDeviceCreateTexture(asPtr(renderer.device), asPtr(descA.ptr)) as number;
		texB = native.symbols.wgpuDeviceCreateTexture(asPtr(renderer.device), asPtr(descB.ptr)) as number;
		prevTex = native.symbols.wgpuDeviceCreateTexture(asPtr(renderer.device), asPtr(descPrev.ptr)) as number;
		if (!texA || !texB || !prevTex) throw new Error("failed to allocate transition textures");
		viewA = native.symbols.wgpuTextureCreateView(asPtr(texA), asPtr(0)) as number;
		viewB = native.symbols.wgpuTextureCreateView(asPtr(texB), asPtr(0)) as number;
		prevTexView = native.symbols.wgpuTextureCreateView(asPtr(prevTex), asPtr(0)) as number;
		if (!viewA || !viewB || !prevTexView) throw new Error("failed to create transition texture views");

		// Pre-build copy descriptors (targetA -> prevTex). Stable until next resize.
		copySrc = makeTexelCopyTextureInfo(texA);
		copyDst = makeTexelCopyTextureInfo(prevTex);
		copyExtent = makeExtent3D(w, h, 1);
		bindKeepalive.push(copySrc.buffer, copyDst.buffer, copyExtent.buffer);

		prevGen++;

		// One bind group per variant, against that variant's own pipeline layout.
		for (const variant of TRANSITION_VARIANTS) {
			const entries = makeBindGroupEntries([
				makeBindGroupEntryBuffer(0, compositeUbo, 0, UNIFORM_SIZE),
				makeBindGroupEntrySampler(1, sampler),
				makeBindGroupEntryTexture(2, viewA),
				makeBindGroupEntryTexture(3, viewB),
			]);
			const desc = makeBindGroupDescriptor(variantLayouts[variant], entries.ptr, 4);
			bindKeepalive.push(entries.buffer, desc.buffer);
			const bg = native.symbols.wgpuDeviceCreateBindGroup(
				asPtr(renderer.device),
				asPtr(desc.ptr),
			) as number;
			if (!bg) throw new Error(`failed to create composite bind group for "${variant}"`);
			variantBindGroups[variant] = bg;
		}
	}

	function setSize(w: number, h: number) {
		if (w === width && h === height) return;
		width = w;
		height = h;
		rebuildTargets(w, h);
	}

	const uboStaging = new ArrayBuffer(UNIFORM_SIZE);
	const uboView = new DataView(uboStaging);

	function composite(encoder: number, swapView: number, mix: number, variant: TransitionVariant) {
		uboView.setFloat32(0, mix, true);
		uboView.setFloat32(4, 0, true);
		uboView.setFloat32(8, width, true);
		uboView.setFloat32(12, height, true);
		native.symbols.wgpuQueueWriteBuffer(
			asPtr(renderer.queue),
			asPtr(compositeUbo),
			0,
			ptr(uboStaging),
			UNIFORM_SIZE,
		);

		const pipeline = variantPipelines[variant] ?? variantPipelines.crossfade;
		const bindGroup = variantBindGroups[variant] ?? variantBindGroups.crossfade;
		const colorAttachment = makeRenderPassColorAttachment(swapView, [0, 0, 0, 1]);
		const renderPassDesc = makeRenderPassDescriptor(colorAttachment.ptr);
		const pass = native.symbols.wgpuCommandEncoderBeginRenderPass(
			asPtr(encoder),
			asPtr(renderPassDesc.ptr),
		) as number;
		native.symbols.wgpuRenderPassEncoderSetPipeline(asPtr(pass), asPtr(pipeline));
		native.symbols.wgpuRenderPassEncoderSetBindGroup(asPtr(pass), 0, asPtr(bindGroup), 0, asPtr(0));
		native.symbols.wgpuRenderPassEncoderDraw(asPtr(pass), 3, 1, 0, 0);
		native.symbols.wgpuRenderPassEncoderEnd(asPtr(pass));
	}

	function copyTargetAToPrev(encoder: number) {
		if (!copySrc || !copyDst || !copyExtent) return;
		native.symbols.wgpuCommandEncoderCopyTextureToTexture(
			asPtr(encoder),
			asPtr(copySrc.ptr),
			asPtr(copyDst.ptr),
			asPtr(copyExtent.ptr),
		);
	}

	const rig: TransitionRig = {
		get width() { return width; },
		get height() { return height; },
		setSize,
		targetAView: () => viewA,
		targetBView: () => viewB,
		composite,
		targetFormat,
		prevSampler: () => prevFrameSampler,
		prevView: () => prevTexView,
		copyTargetAToPrev,
		prevGeneration: () => prevGen,
	};

	(rig as any)._keepalive = keepalive;
	return rig;
}

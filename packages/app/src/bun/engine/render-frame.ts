import { WGPU, WGPUBridge, asPtr } from "../gpu/electrobun-gpu";
import {
	makeCommandBufferArray,
	makeCommandEncoderDescriptor,
	makeRenderPassColorAttachment,
	makeRenderPassDescriptor,
	makeSurfaceTexture,
	updateCommandBufferArray,
	updateRenderPassColorAttachmentView,
} from "../gpu/wgpu-helpers";
import type { Renderer } from "../gpu/renderer";
import type { TransitionRig } from "../gpu/transition";
import type { PackPipeline } from "../gpu/pipeline";
import type { Pack } from "../packs/loader";
import type { PipelineCache } from "./pipeline-cache";
import type { TransitionController, FrameTransition } from "./transitions";
import type { FeatureSmoother } from "./feature-smoother";
import type { UniformWriter } from "./uniform-writer";
import type { PackRegistry } from "../packs/registry";
import type { AudioCapture } from "../audio/capture";

export type RenderFrameDeps = {
	renderer: Renderer;
	transitionRig: TransitionRig;
	pipelineCache: PipelineCache;
	transitions: TransitionController;
	smoother: FeatureSmoother;
	uniforms: UniformWriter;
	registry: PackRegistry;
	capture: AudioCapture;
	startTimeMs: number;
	pushAudioLevel: (rms: number, peak: number) => void;
};

/**
 * Build the per-frame render driver. Returns a function that runs one frame:
 * tick the transition state, gather features, write uniforms, render the
 * from-pack and (during a crossfade) the to-pack, then composite to the
 * swapchain. Encoder/descriptor allocations are shared via closure.
 */
export function createRenderDriver(deps: RenderFrameDeps): () => void {
	const native = WGPU.native;
	// Pre-allocated descriptors — backing buffers stay alive for the lifetime
	// of the driver. We update only the fields that change per-frame.
	const encoderDesc = makeCommandEncoderDescriptor();
	const colorAttachment = makeRenderPassColorAttachment(0, [0, 0, 0, 1]);
	const renderPassDesc = makeRenderPassDescriptor(colorAttachment.ptr);
	const surfaceTexture = makeSurfaceTexture();
	const commandArray = makeCommandBufferArray(0);
	let lastFrame = deps.startTimeMs;
	let lastAudioLevelPushMs = 0;

	function renderPackPass(encoder: number, pp: PackPipeline, finalTargetView: number): void {
		const totalPasses = 1 + pp.extraPasses.length;
		for (let i = 0; i < totalPasses; i++) {
			// Pass 0 → intermediateView[0] (or final target if no extras).
			// Pass i (1..N) → intermediateView[i] (or final target if last).
			const isLast = i === totalPasses - 1;
			const targetView = isLast ? finalTargetView : pp.intermediateView[i];

			const pipelineHandle = i === 0 ? pp.pipeline : pp.extraPasses[i - 1].pipeline;
			const uniformBg = i === 0 ? pp.bindGroup : pp.extraPasses[i - 1].uniformBindGroup;
			const paramBg = i === 0 ? pp.paramBindGroup : pp.extraPasses[i - 1].paramBindGroup;

			// Reuse pre-allocated descriptors — just update the target view.
			updateRenderPassColorAttachmentView(colorAttachment, targetView);
			const pass = native.symbols.wgpuCommandEncoderBeginRenderPass(
				asPtr(encoder),
				asPtr(renderPassDesc.ptr),
			) as number;
			native.symbols.wgpuRenderPassEncoderSetPipeline(asPtr(pass), asPtr(pipelineHandle));
			native.symbols.wgpuRenderPassEncoderSetBindGroup(asPtr(pass), 0, asPtr(uniformBg), 0, asPtr(0));
			if (paramBg) {
				native.symbols.wgpuRenderPassEncoderSetBindGroup(asPtr(pass), 1, asPtr(paramBg), 0, asPtr(0));
			}
			if (i === 0 && pp.prevBindGroup) {
				native.symbols.wgpuRenderPassEncoderSetBindGroup(asPtr(pass), 2, asPtr(pp.prevBindGroup), 0, asPtr(0));
			}
			if (i > 0) {
				native.symbols.wgpuRenderPassEncoderSetBindGroup(
					asPtr(pass),
					3,
					asPtr(pp.extraPasses[i - 1].inputBindGroup),
					0,
					asPtr(0),
				);
			}
			native.symbols.wgpuRenderPassEncoderDraw(asPtr(pass), 3, 1, 0, 0);
			native.symbols.wgpuRenderPassEncoderEnd(asPtr(pass));
		}
	}

	function writePackUniforms(nowMs: number, pack: Pack, pipeline: PackPipeline): void {
		deps.uniforms.write(
			nowMs,
			deps.startTimeMs,
			pack,
			pipeline,
			deps.registry.getParamValues(pack),
			deps.renderer,
			deps.smoother.smoothed,
		);
	}

	return function frame(): void {
		const now = performance.now();
		const delta = now - lastFrame;
		lastFrame = now;
		const elapsed = (now - deps.startTimeMs) / 1000;

		// Surface is always at full retina resolution so it fills the window.
		const surfaceSize = deps.renderer.getSize();
		deps.renderer.reconfigure(surfaceSize.width, surfaceSize.height);

		// Pack shaders render into intermediate targets at the (possibly
		// reduced) render size. The composite pass upscales to the surface.
		const renderSize = deps.renderer.getRenderSize();
		const prevGenBefore = deps.transitionRig.prevGeneration();
		deps.transitionRig.setSize(renderSize.width, renderSize.height);
		if (deps.transitionRig.prevGeneration() !== prevGenBefore) {
			deps.pipelineCache.rebuildResizeAffected(renderSize.width, renderSize.height);
		}

		const live = deps.smoother.update(now, elapsed, deps.capture.status === "capturing");
		// Shaders see the render size as their resolution (so UV calculations are correct).
		deps.uniforms.fillHost(now, deps.startTimeMs, delta, renderSize, deps.smoother.smoothed, deps.smoother.spectrum);
		if (live && now - lastAudioLevelPushMs > 100) {
			lastAudioLevelPushMs = now;
			deps.pushAudioLevel(live.rms, live.peak);
		}
		native.symbols.wgpuInstanceProcessEvents(asPtr(deps.renderer.instance));

		const t: FrameTransition = deps.transitions.tick(now);

		// No pack active — nothing to render, just present a black frame.
		if (!t.from) return;

		// Per-pack uniforms — separate buffers so from/to don't smear during a
		// crossfade.  ensure() is called once per pack; the result is reused by
		// both writePackUniforms and renderPackPass (avoiding redundant lookups).
		const fromPipe = deps.pipelineCache.ensure(t.from);
		if (!fromPipe) return;
		writePackUniforms(now, t.from, fromPipe);
		const toPipe = t.to ? deps.pipelineCache.ensure(t.to) : null;
		if (t.to && toPipe) writePackUniforms(now, t.to, toPipe);

		WGPUBridge.surfaceGetCurrentTexture(deps.renderer.surface, surfaceTexture.ptr);
		const status = surfaceTexture.view.getUint32(16, true);
		if (status !== 1 && status !== 2) return;
		const texPtr = Number(surfaceTexture.view.getBigUint64(8, true));
		if (!texPtr) return;

		const swapView = native.symbols.wgpuTextureCreateView(asPtr(texPtr), asPtr(0)) as number;
		if (!swapView) return;

		const encoder = native.symbols.wgpuDeviceCreateCommandEncoder(
			asPtr(deps.renderer.device),
			asPtr(encoderDesc.ptr),
		) as number;

		// Pass 1: from-pack -> target A
		renderPackPass(encoder, fromPipe, deps.transitionRig.targetAView());
		// Pass 2 (only during transition): to-pack -> target B
		if (toPipe) {
			renderPackPass(encoder, toPipe, deps.transitionRig.targetBView());
		}
		// Pass 3: composite -> swapchain (at full surface resolution)
		deps.transitionRig.composite(encoder, swapView, t.mix, t.variant, surfaceSize.width, surfaceSize.height);
		// Snapshot targetA into the prev-frame texture so the next frame's
		// packs can sample it via @group(2).
		deps.transitionRig.copyTargetAToPrev(encoder);

		const commandBuffer = native.symbols.wgpuCommandEncoderFinish(asPtr(encoder), asPtr(0)) as number;
		updateCommandBufferArray(commandArray, commandBuffer);
		native.symbols.wgpuQueueSubmit(asPtr(deps.renderer.queue), 1, asPtr(commandArray.ptr));
		WGPUBridge.surfacePresent(deps.renderer.surface);

		native.symbols.wgpuTextureViewRelease(asPtr(swapView));
		native.symbols.wgpuTextureRelease(asPtr(texPtr));
		native.symbols.wgpuCommandBufferRelease(asPtr(commandBuffer));
		native.symbols.wgpuCommandEncoderRelease(asPtr(encoder));
	};
}

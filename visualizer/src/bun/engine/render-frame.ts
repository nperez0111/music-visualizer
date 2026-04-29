import { WGPU, WGPUBridge } from "electrobun/bun";
import {
	makeCommandBufferArray,
	makeCommandEncoderDescriptor,
	makeRenderPassColorAttachment,
	makeRenderPassDescriptor,
	makeSurfaceTexture,
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
	// Captured via closure — its backing buffer stays alive for the lifetime
	// of the driver.
	const encoderDesc = makeCommandEncoderDescriptor();
	let lastFrame = deps.startTimeMs;
	let lastAudioLevelPushMs = 0;

	function renderPackPass(encoder: number, pack: Pack, finalTargetView: number): boolean {
		const pp = deps.pipelineCache.ensure(pack);
		if (!pp) return false;
		const totalPasses = 1 + pp.extraPasses.length;
		for (let i = 0; i < totalPasses; i++) {
			// Pass 0 → intermediateView[0] (or final target if no extras).
			// Pass i (1..N) → intermediateView[i] (or final target if last).
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
			if (paramBg) {
				native.symbols.wgpuRenderPassEncoderSetBindGroup(pass, 1, paramBg, 0, 0);
			}
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
		return true;
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

		const size = deps.renderer.getSize();
		deps.renderer.reconfigure(size.width, size.height);
		const prevGenBefore = deps.transitionRig.prevGeneration();
		deps.transitionRig.setSize(size.width, size.height);
		if (deps.transitionRig.prevGeneration() !== prevGenBefore) {
			deps.pipelineCache.rebuildResizeAffected(size.width, size.height);
		}

		const live = deps.smoother.update(now, elapsed, deps.capture.status === "capturing");
		deps.uniforms.fillHost(now, deps.startTimeMs, delta, size, deps.smoother.smoothed, deps.smoother.spectrum);
		if (live && now - lastAudioLevelPushMs > 100) {
			lastAudioLevelPushMs = now;
			deps.pushAudioLevel(live.rms, live.peak);
		}
		native.symbols.wgpuInstanceProcessEvents(deps.renderer.instance);

		const t: FrameTransition = deps.transitions.tick(now);

		// Per-pack uniforms — separate buffers so from/to don't smear during a
		// crossfade.
		const fromPipe = deps.pipelineCache.ensure(t.from);
		if (fromPipe) writePackUniforms(now, t.from, fromPipe);
		const toPipe = t.to ? deps.pipelineCache.ensure(t.to) : null;
		if (t.to && toPipe) writePackUniforms(now, t.to, toPipe);

		const surfaceTexture = makeSurfaceTexture();
		WGPUBridge.surfaceGetCurrentTexture(deps.renderer.surface, surfaceTexture.ptr);
		const status = surfaceTexture.view.getUint32(16, true);
		if (status !== 1 && status !== 2) return;
		const texPtr = Number(surfaceTexture.view.getBigUint64(8, true));
		if (!texPtr) return;

		const swapView = native.symbols.wgpuTextureCreateView(texPtr, 0) as number;
		if (!swapView) return;

		const encoder = native.symbols.wgpuDeviceCreateCommandEncoder(
			deps.renderer.device,
			encoderDesc.ptr,
		) as number;

		// Pass 1: from-pack -> target A
		if (!renderPackPass(encoder, t.from, deps.transitionRig.targetAView())) {
			native.symbols.wgpuTextureViewRelease(swapView);
			native.symbols.wgpuTextureRelease(texPtr);
			return;
		}
		// Pass 2 (only during transition): to-pack -> target B
		if (t.to) {
			renderPackPass(encoder, t.to, deps.transitionRig.targetBView());
		}
		// Pass 3: composite -> swapchain
		deps.transitionRig.composite(encoder, swapView, t.mix, t.variant);
		// Snapshot targetA into the prev-frame texture so the next frame's
		// packs can sample it via @group(2).
		deps.transitionRig.copyTargetAToPrev(encoder);

		const commandBuffer = native.symbols.wgpuCommandEncoderFinish(encoder, 0) as number;
		const commandArray = makeCommandBufferArray(commandBuffer);
		native.symbols.wgpuQueueSubmit(deps.renderer.queue, 1, commandArray.ptr);
		WGPUBridge.surfacePresent(deps.renderer.surface);

		native.symbols.wgpuTextureViewRelease(swapView);
		native.symbols.wgpuTextureRelease(texPtr);
		native.symbols.wgpuCommandBufferRelease(commandBuffer);
		native.symbols.wgpuCommandEncoderRelease(encoder);
	};
}

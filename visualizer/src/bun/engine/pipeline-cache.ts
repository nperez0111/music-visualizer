import {
	createPackPipeline,
	rebuildPackChain,
	rebuildPackPrevBindGroup,
	releasePackPipeline,
	type PackPipeline,
} from "../gpu/pipeline";
import type { Renderer } from "../gpu/renderer";
import type { TransitionRig } from "../gpu/transition";
import type { Pack } from "../packs/loader";
import { parameterBufferSize } from "../packs/parameters";

/**
 * Bounded LRU cache of compiled pack pipelines. Map iteration order is
 * insertion order, so re-inserting on access gives us LRU for free.
 *
 * Eviction respects a caller-provided "pinned ids" set so the active pack and
 * any in-flight transition's from/to are never evicted regardless of pressure.
 */
export class PipelineCache {
	private readonly entries = new Map<string, PackPipeline>();

	constructor(
		private readonly renderer: Renderer,
		private readonly transitionRig: TransitionRig,
		private readonly uniformBufferSize: number,
		private readonly getPinnedIds: () => Set<string>,
		private readonly limit: number = 12,
	) {}

	ensure(p: Pack): PackPipeline | null {
		let pp = this.entries.get(p.id);
		if (pp) {
			this.entries.delete(p.id);
			this.entries.set(p.id, pp);
			if (p.usesPrevFrame) {
				rebuildPackPrevBindGroup(
					pp,
					this.renderer,
					this.transitionRig.prevView(),
					this.transitionRig.prevSampler(),
					this.transitionRig.prevGeneration(),
				);
			}
			if (pp.extraPasses.length > 0) {
				const sz = this.renderer.getSize();
				rebuildPackChain(pp, this.renderer, sz.width, sz.height);
			}
			return pp;
		}
		try {
			const sz = this.renderer.getSize();
			pp = createPackPipeline({
				renderer: this.renderer,
				shaderText: p.shaderText,
				uniformBufferSize: this.uniformBufferSize,
				paramBufferSize: p.parameters.length > 0 ? parameterBufferSize(p.parameters) : 0,
				usesPrevFrame: p.usesPrevFrame,
				prevFrameView: p.usesPrevFrame ? this.transitionRig.prevView() : 0,
				prevFrameSampler: p.usesPrevFrame ? this.transitionRig.prevSampler() : 0,
				prevGeneration: this.transitionRig.prevGeneration(),
				extraPassShaders: p.extraPasses,
				chainWidth: sz.width,
				chainHeight: sz.height,
			});
			this.entries.set(p.id, pp);
			this.evictLru();
			console.log(
				`[packs] pipeline built for "${p.id}"` +
					(p.parameters.length > 0 ? ` (params=${p.parameters.length})` : "") +
					(p.usesPrevFrame ? " (prev-frame)" : "") +
					(p.extraPasses.length > 0 ? ` (passes=${1 + p.extraPasses.length})` : ""),
			);
			return pp;
		} catch (err) {
			console.error(`[packs] failed to build pipeline for "${p.id}":`, err);
			return null;
		}
	}

	/** Drop and release a single pack's pipeline (used by hot-reload + uninstall). */
	invalidate(id: string): void {
		const pp = this.entries.get(id);
		if (!pp) return;
		this.entries.delete(id);
		releasePackPipeline(pp);
	}

	/**
	 * After a resize, refresh the prev-frame bind group on packs that use it
	 * and rebuild any multi-pass intermediate textures since they share the
	 * surface size.
	 */
	rebuildResizeAffected(width: number, height: number): void {
		for (const pp of this.entries.values()) {
			if (pp.prevBindLayout) {
				rebuildPackPrevBindGroup(
					pp,
					this.renderer,
					this.transitionRig.prevView(),
					this.transitionRig.prevSampler(),
					this.transitionRig.prevGeneration(),
				);
			}
			if (pp.extraPasses.length > 0) {
				rebuildPackChain(pp, this.renderer, width, height);
			}
		}
	}

	private evictLru(): void {
		if (this.entries.size <= this.limit) return;
		const pinned = this.getPinnedIds();
		for (const id of this.entries.keys()) {
			if (this.entries.size <= this.limit) break;
			if (pinned.has(id)) continue;
			const pp = this.entries.get(id)!;
			this.entries.delete(id);
			releasePackPipeline(pp);
		}
	}
}

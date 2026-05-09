import { pickRandomTransitionVariant, type TransitionVariant } from "../gpu/transition";
import type { Pack } from "../packs/loader";
import type { AutoSettings } from "../../shared/rpc-types";

const DEFAULT_TRANSITION_MS = 1500;

type Transition =
	| { kind: "idle" }
	| {
		kind: "active";
		variant: TransitionVariant;
		from: Pack;
		to: Pack;
		startMs: number;
		durationMs: number;
	};

/** Per-frame snapshot of what to render. */
export type FrameTransition = {
	from: Pack;
	to: Pack | null;
	mix: number;
	variant: TransitionVariant;
};

/**
 * Owns the "what is currently active and what's transitioning to what"
 * state machine, plus the auto-rotation timer. The render loop calls
 * `tick(now)` once per frame to advance the state machine and read what
 * to render.
 */
export class TransitionController {
	private active: Pack;
	private transition: Transition = { kind: "idle" };
	private autoSettings: AutoSettings;
	private autoTimer: ReturnType<typeof setInterval> | null = null;

	constructor(
		initial: Pack,
		autoSettings: AutoSettings,
		private deps: {
			getPacks: () => Pack[];
			ensurePipeline: (p: Pack) => unknown;
			onActivePackChanged: (id: string) => void;
		},
	) {
		this.active = initial;
		this.autoSettings = { ...autoSettings };
	}

	/**
	 * Replace the dependency callbacks. Used when the engine initializes
	 * after the controller was created (deferred renderer init).
	 */
	setCallbacks(deps: {
		getPacks: () => Pack[];
		ensurePipeline: (p: Pack) => unknown;
		onActivePackChanged: (id: string) => void;
	}): void {
		this.deps = deps;
	}

	getActive(): Pack {
		return this.active;
	}

	getActiveId(): string {
		return this.active.id;
	}

	/** Set of pack ids that must not be evicted from caches this frame. */
	pinnedIds(): Set<string> {
		const s = new Set<string>([this.active.id]);
		if (this.transition.kind === "active") {
			s.add(this.transition.from.id);
			s.add(this.transition.to.id);
		}
		return s;
	}

	getAutoSettings(): AutoSettings {
		return { ...this.autoSettings };
	}

	setAutoSettings(s: AutoSettings): void {
		this.autoSettings = {
			enabled: !!s.enabled,
			seconds: Math.max(5, Math.round(s.seconds)),
			shuffle: !!s.shuffle,
		};
		this.rescheduleAutoTimer();
	}

	rescheduleAutoTimer(): void {
		if (this.autoTimer) {
			clearInterval(this.autoTimer);
			this.autoTimer = null;
		}
		if (!this.autoSettings.enabled) return;
		const ms = Math.max(5, this.autoSettings.seconds) * 1000;
		this.autoTimer = setInterval(() => {
			// Don't stack transitions; if one is running we'll catch the next tick.
			if (this.transition.kind === "active") return;
			const next = this.pickNext();
			if (next) this.request(next);
		}, ms);
	}

	stop(): void {
		if (this.autoTimer) {
			clearInterval(this.autoTimer);
			this.autoTimer = null;
		}
	}

	pickNext(): Pack | null {
		const packs = this.deps.getPacks();
		if (packs.length < 2) return null;
		if (this.autoSettings.shuffle) {
			// Try a few times to avoid landing back on the active pack.
			for (let i = 0; i < 16; i++) {
				const cand = packs[Math.floor(Math.random() * packs.length)]!;
				if (cand.id !== this.active.id) return cand;
			}
			return null;
		}
		const idx = packs.findIndex((p) => p.id === this.active.id);
		return packs[(idx + 1) % packs.length] ?? null;
	}

	request(next: Pack): void {
		if (next.id === this.active.id) return;
		// Snap-finish any in-progress transition so the new one starts clean.
		if (this.transition.kind === "active") {
			this.active = this.transition.to;
			this.transition = { kind: "idle" };
		}
		this.deps.ensurePipeline(next);
		this.transition = {
			kind: "active",
			variant: pickRandomTransitionVariant(),
			from: this.active,
			to: next,
			startMs: performance.now(),
			durationMs: DEFAULT_TRANSITION_MS,
		};
		this.deps.onActivePackChanged(next.id);
	}

	/**
	 * Resolve the per-frame transition state. Mutates internal state when a
	 * transition completes (advances `active` to the to-pack).
	 */
	tick(nowMs: number): FrameTransition {
		if (this.transition.kind !== "active") {
			return { from: this.active, to: null, mix: 0, variant: "crossfade" };
		}
		const t = (nowMs - this.transition.startMs) / this.transition.durationMs;
		if (t >= 1) {
			this.active = this.transition.to;
			this.transition = { kind: "idle" };
			return { from: this.active, to: null, mix: 0, variant: "crossfade" };
		}
		return {
			from: this.transition.from,
			to: this.transition.to,
			mix: t,
			variant: this.transition.variant,
		};
	}

	/**
	 * Hot-reload swap: replace any references to `prevId` (the pack's id
	 * before the edit) with a fresh Pack object. Pack ids are content-
	 * addressed, so editing a pack rolls its id; passing the prior id lets
	 * us re-target the active selection across that roll. Falls back to
	 * matching by `fresh.id` when `prevId` isn't supplied (no-op edits or
	 * non-content changes).
	 */
	swapPack(fresh: Pack, prevId?: string | null): void {
		const target = prevId ?? fresh.id;
		if (this.active.id === target) this.active = fresh;
		if (this.transition.kind === "active") {
			if (this.transition.from.id === target) this.transition.from = fresh;
			if (this.transition.to.id === target) this.transition.to = fresh;
		}
	}

	/**
	 * Used after `reloadPacks()`: if the previously active pack is gone (e.g.
	 * a user pack was removed), fall back to the first available pack.
	 */
	rebindActive(packs: Pack[]): boolean {
		const stillThere = packs.find((p) => p.id === this.active.id);
		if (stillThere) {
			this.active = stillThere;
			return false;
		}
		this.active = packs[0]!;
		return true;
	}
}

import type { BrowserWindow, GpuWindow } from "electrobun/bun";
import { Screen } from "electrobun/bun";
import { getPref, setPref } from "./db";

export type Bounds = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

const COLLAPSED_W = 160;
const COLLAPSED_H = 40;

const PREFS = {
	visualizerBounds: "window.visualizer.bounds",
	controlsPosition: "window.controls.position",
	controlsExpandedSize: "window.controls.expandedSize",
	controlsCollapsed: "window.controls.collapsed",
} as const;

export type LoadedWindowPrefs = {
	visualizerBounds: Bounds;
	controlsPosition: { x: number; y: number };
	controlsExpandedSize: Size;
	controlsCollapsed: boolean;
};

export function loadWindowPrefs(): LoadedWindowPrefs {
	const workArea = Screen.getPrimaryDisplay().workArea;
	return {
		visualizerBounds: getPref<Bounds>(PREFS.visualizerBounds, {
			x: workArea.x + 160,
			y: workArea.y + 120,
			width: 960,
			height: 600,
		}),
		controlsPosition: getPref<{ x: number; y: number }>(PREFS.controlsPosition, {
			x: workArea.x + 176,
			y: workArea.y + 136,
		}),
		controlsExpandedSize: getPref<Size>(PREFS.controlsExpandedSize, {
			width: 340,
			height: 220,
		}),
		controlsCollapsed: getPref<boolean>(PREFS.controlsCollapsed, false),
	};
}

export function controlsSizeFor(collapsed: boolean, expandedSize: Size): Size {
	return collapsed ? { width: COLLAPSED_W, height: COLLAPSED_H } : expandedSize;
}

/**
 * Wires window move/resize events to debounced pref persistence and exposes
 * the controls-collapse and fullscreen toggles. Mutates `state` in place so
 * caller code reading `state.controlsCollapsed` etc. sees current values.
 */
export class WindowPrefsManager {
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private preFullscreenBounds: Bounds | null = null;

	constructor(
		private readonly state: LoadedWindowPrefs,
		private readonly renderWin: GpuWindow,
		private readonly controlsWin: BrowserWindow,
		private readonly onCollapsedChanged: (collapsed: boolean) => void,
	) {
		this.attachListeners();
	}

	get controlsCollapsed(): boolean {
		return this.state.controlsCollapsed;
	}

	setControlsCollapsed(collapsed: boolean, broadcast: boolean): void {
		if (collapsed === this.state.controlsCollapsed) return;
		this.state.controlsCollapsed = collapsed;
		setPref(PREFS.controlsCollapsed, collapsed);
		const size = controlsSizeFor(collapsed, this.state.controlsExpandedSize);
		this.controlsWin.setSize(size.width, size.height);
		if (broadcast) this.onCollapsedChanged(collapsed);
	}

	toggleCollapsed(): void {
		this.setControlsCollapsed(!this.state.controlsCollapsed, true);
	}

	toggleFullscreen(): void {
		if (this.preFullscreenBounds) {
			const b = this.preFullscreenBounds;
			this.preFullscreenBounds = null;
			this.renderWin.setFrame(b.x, b.y, b.width, b.height);
			return;
		}
		this.preFullscreenBounds = this.renderWin.getFrame() as Bounds;
		const wa = Screen.getPrimaryDisplay().workArea;
		this.renderWin.setFrame(wa.x, wa.y, wa.width, wa.height);
	}

	private debounce(fn: () => void): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(fn, 250);
	}

	private attachListeners(): void {
		this.renderWin.on("move", () =>
			this.debounce(() => setPref(PREFS.visualizerBounds, this.renderWin.getFrame())),
		);
		this.renderWin.on("resize", () =>
			this.debounce(() => setPref(PREFS.visualizerBounds, this.renderWin.getFrame())),
		);
		this.controlsWin.on("move", () =>
			this.debounce(() => {
				const c = this.controlsWin.getFrame();
				this.state.controlsPosition = { x: c.x, y: c.y };
				setPref(PREFS.controlsPosition, this.state.controlsPosition);
			}),
		);
		this.controlsWin.on("resize", () =>
			this.debounce(() => {
				if (this.state.controlsCollapsed) return;
				const c = this.controlsWin.getFrame();
				this.state.controlsExpandedSize = { width: c.width, height: c.height };
				setPref(PREFS.controlsExpandedSize, this.state.controlsExpandedSize);
			}),
		);
	}
}

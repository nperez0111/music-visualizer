import type { BrowserWindow } from "electrobun/bun";
import { Screen } from "electrobun/bun";
import { getPref, setPref } from "./db";

export type Bounds = { x: number; y: number; width: number; height: number };

const PREFS = {
	windowBounds: "window.bounds",
	sidebarCollapsed: "window.sidebar.collapsed",
} as const;

export type LoadedWindowPrefs = {
	windowBounds: Bounds;
	sidebarCollapsed: boolean;
};

export function loadWindowPrefs(): LoadedWindowPrefs {
	const workArea = Screen.getPrimaryDisplay().workArea;
	return {
		windowBounds: getPref<Bounds>(PREFS.windowBounds, {
			x: workArea.x + 100,
			y: workArea.y + 60,
			width: 1200,
			height: 720,
		}),
		sidebarCollapsed: getPref<boolean>(PREFS.sidebarCollapsed, false),
	};
}

/**
 * Wires window move/resize events to debounced pref persistence and exposes
 * the sidebar-collapse and fullscreen toggles.
 */
export class WindowPrefsManager {
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	private preFullscreenBounds: Bounds | null = null;

	constructor(
		private readonly state: LoadedWindowPrefs,
		private readonly win: BrowserWindow,
		private readonly onCollapsedChanged: (collapsed: boolean) => void,
	) {
		this.attachListeners();
	}

	get sidebarCollapsed(): boolean {
		return this.state.sidebarCollapsed;
	}

	setSidebarCollapsed(collapsed: boolean, broadcast: boolean): void {
		if (collapsed === this.state.sidebarCollapsed) return;
		this.state.sidebarCollapsed = collapsed;
		setPref(PREFS.sidebarCollapsed, collapsed);
		if (broadcast) this.onCollapsedChanged(collapsed);
	}

	toggleCollapsed(): void {
		this.setSidebarCollapsed(!this.state.sidebarCollapsed, true);
	}

	toggleFullscreen(): void {
		if (this.preFullscreenBounds) {
			const b = this.preFullscreenBounds;
			this.preFullscreenBounds = null;
			this.win.setFrame(b.x, b.y, b.width, b.height);
			return;
		}
		this.preFullscreenBounds = this.win.getFrame() as Bounds;
		const wa = Screen.getPrimaryDisplay().workArea;
		this.win.setFrame(wa.x, wa.y, wa.width, wa.height);
	}

	private debounce(fn: () => void): void {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(fn, 250);
	}

	private attachListeners(): void {
		this.win.on("move", () =>
			this.debounce(() => setPref(PREFS.windowBounds, this.win.getFrame())),
		);
		this.win.on("resize", () =>
			this.debounce(() => setPref(PREFS.windowBounds, this.win.getFrame())),
		);
	}
}

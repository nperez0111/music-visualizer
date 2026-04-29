import {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	GlobalShortcut,
	GpuWindow,
	Utils,
} from "electrobun/bun";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { setPref, getPref } from "./db";
import { USER_PACKS_DIR } from "./paths";
import { RingBuffer } from "./audio/ring-buffer";
import { AudioAnalyzer } from "./audio/analysis";
import { AudioCapture } from "./audio/capture";
import { importVizFile } from "./packs/import";
import { PackRegistry } from "./packs/registry";
import { createRenderer } from "./gpu/renderer";
import { createTransitionRig } from "./gpu/transition";
import { PipelineCache } from "./engine/pipeline-cache";
import { TransitionController } from "./engine/transitions";
import { FeatureSmoother } from "./engine/feature-smoother";
import { UniformWriter } from "./engine/uniform-writer";
import { createRenderDriver } from "./engine/render-frame";
import { loadWindowPrefs, controlsSizeFor, WindowPrefsManager } from "./window-prefs";
import type { AutoSettings, ControlsRPC } from "../shared/rpc-types";

if (!existsSync(USER_PACKS_DIR)) mkdirSync(USER_PACKS_DIR, { recursive: true });

// ---------- Constants ----------

const SPECTRUM_BINS = 32;
// Sized to fit a Mandelbrot perturbation reference orbit at 1024 iterations
// (8192 bytes packed two-points-per-vec4) plus a small WASM header, on top
// of the 176 host-reserved bytes. 16 KB matches wgpu's guaranteed
// `maxUniformBufferBindingSize` minimum, so it's portable everywhere.
const UNIFORM_BUFFER_SIZE = 16384;
// Standard host-filled portion of the uniform buffer (scalars + spectrum).
// Tier 2 (WASM) packs may write up to UNIFORM_BUFFER_SIZE - PACK_UNIFORM_OFFSET
// custom bytes which the host stages here each frame.
const PACK_UNIFORM_OFFSET = 176;
const RING_SIZE = 4096;
const FFT_SIZE = 1024;

// ---------- Window prefs + packs + audio ----------

const windowPrefs = loadWindowPrefs();

const registry = await PackRegistry.create(USER_PACKS_DIR);

const initialActiveId = getPref<string>("active.pack.id", registry.list()[0]!.id);
const initialActive = registry.byId(initialActiveId) ?? registry.list()[0]!;

const autoSettings: AutoSettings = {
	enabled: getPref<boolean>("auto.enabled", false),
	seconds: getPref<number>("auto.seconds", 30),
	shuffle: getPref<boolean>("auto.shuffle", true),
};

console.log(`[packs] active: ${initialActive.id}`);

const audioBuffer = new RingBuffer(RING_SIZE);
const audioAnalyzer = new AudioAnalyzer(audioBuffer, 48000, FFT_SIZE);
const capture = new AudioCapture(audioBuffer);

capture.onStatusChange((status, detail) => {
	console.log(`[audio] status=${status}${detail ? ` (${detail})` : ""}`);
	if (status === "capturing") audioAnalyzer.sampleRate = capture.sampleRate;
	try {
		controlsWin.webview?.rpc?.send?.audioStatus({ status, detail });
	} catch {}
});

// ---------- RPC ----------

const rpc = BrowserView.defineRPC<ControlsRPC>({
	maxRequestTime: 10000,
	handlers: {
		requests: {
			getInitialState: () => ({
				collapsed: windowPrefs.controlsCollapsed,
				audioStatus: capture.status,
				packs: registry.allPackInfos(),
				activePackId: transitions.getActiveId(),
				auto: transitions.getAutoSettings(),
			}),
			getControlsPosition: () => {
				const f = controlsWin.getFrame();
				return { x: f.x, y: f.y };
			},
			listPacks: () => ({
				packs: registry.allPackInfos(),
				activePackId: transitions.getActiveId(),
			}),
			importPack: async () => {
				try {
					const result = await Utils.openFileDialog({
						allowedFileTypes: "viz",
						allowsMultipleSelection: false,
					});
					const path = Array.isArray(result) ? result[0] : result;
					if (!path || typeof path !== "string") return { ok: false, error: "no file selected" };
					const r = importVizFile(path, USER_PACKS_DIR);
					if (!r.ok) return { ok: false, error: r.error };
					await reloadAfterImport();
					return { ok: true, id: r.id };
				} catch (err) {
					return { ok: false, error: String(err) };
				}
			},
			importPackBytes: async ({ fileName, bytesB64 }) => {
				// Drag-drop entry point. WKWebView doesn't expose dropped file paths,
				// so the webview reads bytes and sends them over RPC; we stage to a
				// temp .viz and reuse the existing extractor.
				const safeBase = String(fileName || "drop.viz").replace(/[^a-z0-9._-]/gi, "_");
				const stagePath = join(tmpdir(), `viz-drop-${process.pid}-${Date.now()}-${safeBase}`);
				try {
					const bytes = Buffer.from(bytesB64, "base64");
					writeFileSync(stagePath, bytes);
					const r = importVizFile(stagePath, USER_PACKS_DIR);
					if (!r.ok) return { ok: false, error: r.error };
					await reloadAfterImport();
					return { ok: true, id: r.id };
				} catch (err) {
					return { ok: false, error: String(err) };
				} finally {
					try { unlinkSync(stagePath); } catch {}
				}
			},
		},
		messages: {
			setCollapsed: ({ collapsed }) => windowMgr.setControlsCollapsed(collapsed, false),
			setControlsPosition: ({ x, y }) => controlsWin.setPosition(x, y),
			setActivePack: ({ id }) => {
				const next = registry.byId(id);
				if (!next) {
					console.warn(`[packs] requested unknown pack: ${id}`);
					return;
				}
				transitions.request(next);
				// User picked manually; give them a full interval before auto fires.
				transitions.rescheduleAutoTimer();
			},
			nextPack: () => {
				const next = transitions.pickNext();
				if (next) {
					transitions.request(next);
					transitions.rescheduleAutoTimer();
				}
			},
			setAutoSettings: ({ enabled, seconds, shuffle }) => {
				transitions.setAutoSettings({ enabled, seconds, shuffle });
				const s = transitions.getAutoSettings();
				setPref("auto.enabled", s.enabled);
				setPref("auto.seconds", s.seconds);
				setPref("auto.shuffle", s.shuffle);
			},
			removePack: ({ id }) => {
				const result = registry.removeUser(id);
				if (!result.ok) {
					console.warn(`[packs] cannot remove "${id}": ${result.reason}`);
					return;
				}
				pipelineCache.invalidate(id);
				void reloadAfterImport();
			},
			setPackParameter: ({ packId, name, value }) => {
				registry.setParameter(packId, name, value);
			},
			openScreenCapturePrefs: () => {
				try {
					Bun.spawn([
						"open",
						"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
					]);
				} catch (err) {
					console.warn("[viz] failed to open screen-capture prefs:", err);
				}
			},
			applyPreset: ({ packId, presetName }) => {
				registry.applyPreset(packId, presetName);
			},
		},
	},
});

async function reloadAfterImport(): Promise<void> {
	const fresh = await registry.reload();
	if (transitions.rebindActive(fresh)) {
		setPref("active.pack.id", transitions.getActiveId());
	}
	broadcastPacksChanged();
}

function broadcastPacksChanged(): void {
	try {
		controlsWin.webview?.rpc?.send?.packsChanged({
			packs: registry.allPackInfos(),
			activePackId: transitions.getActiveId(),
		});
	} catch {}
}

// ---------- Windows ----------

const renderWin = new GpuWindow({
	title: "music-visualizer",
	frame: windowPrefs.visualizerBounds,
	titleBarStyle: "default",
	transparent: false,
});

const initialControlsSize = controlsSizeFor(
	windowPrefs.controlsCollapsed,
	windowPrefs.controlsExpandedSize,
);
const controlsWin = new BrowserWindow({
	title: "music-visualizer-controls",
	url: "views://mainview/index.html",
	frame: {
		x: windowPrefs.controlsPosition.x,
		y: windowPrefs.controlsPosition.y,
		width: initialControlsSize.width,
		height: initialControlsSize.height,
	},
	titleBarStyle: "hidden",
	transparent: true,
	rpc,
});
controlsWin.setAlwaysOnTop(true);

const windowMgr = new WindowPrefsManager(
	windowPrefs,
	renderWin,
	controlsWin,
	(collapsed) => {
		try { controlsWin.webview?.rpc?.send?.collapsedChanged({ collapsed }); } catch {}
	},
);

// ---------- View toggles (menu / global shortcut) ----------

ApplicationMenu.setApplicationMenu([
	{ label: "music-visualizer", submenu: [{ role: "quit" }] },
	{
		label: "View",
		submenu: [
			{ label: "Toggle Controls", action: "toggleControls", accelerator: "CommandOrControl+Shift+H" },
			{ label: "Toggle Fullscreen", action: "toggleFullscreen", accelerator: "CommandOrControl+Control+F" },
		],
	},
]);

ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
	const action = (event as { action?: string } | undefined)?.action;
	if (action === "toggleControls") windowMgr.toggleCollapsed();
	else if (action === "toggleFullscreen") windowMgr.toggleFullscreen();
});

const SHORTCUT = "CommandOrControl+Shift+H";
if (!GlobalShortcut.register(SHORTCUT, () => windowMgr.toggleCollapsed())) {
	console.warn(`[viz] failed to register global shortcut ${SHORTCUT}`);
}

// ---------- Engine ----------

const renderer = createRenderer(renderWin);

// A/B render targets + composite (crossfade) pipeline. Built first so any
// pack pipeline can reference the prev-frame view at construction time.
const transitionRig = createTransitionRig(renderer);
{
	const initSize = renderer.getSize();
	transitionRig.setSize(initSize.width, initSize.height);
}

// Explicit annotations break the inferential cycle between these two:
// pipelineCache reads transitions.pinnedIds() at eviction time, and
// transitions calls pipelineCache.ensure() to pre-build the to-pack.
const pipelineCache: PipelineCache = new PipelineCache(
	renderer,
	transitionRig,
	UNIFORM_BUFFER_SIZE,
	() => transitions.pinnedIds(),
);

const transitions: TransitionController = new TransitionController(initialActive, autoSettings, {
	getPacks: () => registry.list(),
	ensurePipeline: (p) => pipelineCache.ensure(p),
	onActivePackChanged: (id) => {
		setPref("active.pack.id", id);
		try { controlsWin.webview?.rpc?.send?.activePackChanged({ id }); } catch {}
	},
});

registry.onChange(broadcastPacksChanged);

// Pack pipeline self-test mode (used by `bun run test:gpu`). Builds a real
// pipeline for every loaded pack so WGSL parse/binding errors surface, then
// exits. Runs *before* the active-pack pre-build and the render driver, so
// (a) the very first compile of each pack lives inside its BEGIN/END window
// and (b) we don't pollute the output with subsequent render-time errors
// from a broken active pipeline. wgpu-native prints validation errors to
// stderr synchronously during the FFI call, so the driver script can
// correlate them by pack id from the merged stream.
if (process.env["VIZ_PACKS_SELFTEST"] === "1") {
	const packs = registry.list();
	let buildFails = 0;
	console.log(`[selftest] starting pipeline build sweep (${packs.length} pack(s))`);
	for (const p of packs) {
		console.log(`[SELFTEST_BEGIN] ${p.id}`);
		const pp = pipelineCache.ensure(p);
		if (!pp) buildFails++;
		console.log(`[SELFTEST_END] ${p.id}`);
	}
	console.log(`[selftest] sweep complete (${packs.length - buildFails}/${packs.length} pipelines built)`);
	// Synchronous exit. Dawn writes uncaptured errors to stderr inline from the
	// FFI call, so they're already in the pipe buffer by now. Avoid setTimeout +
	// renderDriver creation, which would stack render-time errors on top.
	process.exit(buildFails > 0 ? 1 : 0);
}

// Pre-build the active pack's pipeline so the first frame doesn't stall.
pipelineCache.ensure(initialActive);
console.log("[visualizer] pipeline ready, surfaceFormat=" + renderer.surfaceFormat);
void capture.start();
transitions.rescheduleAutoTimer();

// Hot-reload: drop the cached pipeline on shader/manifest/wasm change so the
// next frame rebuilds; also swap the Pack reference inside the transition
// state machine if the changed pack happens to be active or transitioning.
registry.watchForDevReload({
	onPackUpdated: (fresh) => {
		transitions.swapPack(fresh);
		pipelineCache.invalidate(fresh.id);
	},
});

const smoother = new FeatureSmoother(audioAnalyzer, SPECTRUM_BINS);
const uniforms = new UniformWriter({
	bufferSize: UNIFORM_BUFFER_SIZE,
	packOffset: PACK_UNIFORM_OFFSET,
	spectrumBins: SPECTRUM_BINS,
});

const startTimeMs = performance.now();
const renderDriver = createRenderDriver({
	renderer,
	transitionRig,
	pipelineCache,
	transitions,
	smoother,
	uniforms,
	registry,
	capture,
	startTimeMs,
	pushAudioLevel: (rms, peak) => {
		try { controlsWin.webview?.rpc?.send?.audioLevel({ rms, peak }); } catch {}
	},
});

// ---------- Render loop ----------

// Render-error surfacing: log once per ~5s window and push a banner to the
// controls UI so silent stalls are visible. We don't throw out of the loop —
// the next frame retries.
const RENDER_ERROR_THROTTLE_MS = 5000;
let lastRenderErrorAt = 0;
function reportRenderError(err: unknown): void {
	const now = performance.now();
	if (now - lastRenderErrorAt < RENDER_ERROR_THROTTLE_MS) return;
	lastRenderErrorAt = now;
	const message = err instanceof Error ? err.message : String(err);
	console.error("[visualizer] render error:", err);
	try {
		controlsWin.webview?.rpc?.send?.renderError({ message });
	} catch {}
}

// Self-pacing render loop: aim for ~60fps but subtract real frame cost from
// the next delay so a slow frame doesn't stack work. setInterval would fire
// regardless of how long the previous tick took.
const TARGET_FRAME_MS = 16;
let stopRenderLoop = false;
function tickRenderLoop(): void {
	const start = performance.now();
	try {
		renderDriver();
	} catch (err) {
		reportRenderError(err);
	}
	if (stopRenderLoop) return;
	const wait = Math.max(0, TARGET_FRAME_MS - (performance.now() - start));
	setTimeout(tickRenderLoop, wait);
}
tickRenderLoop();

// ---------- Lifecycle ----------

renderWin.on("close", () => {
	stopRenderLoop = true;
	transitions.stop();
	capture.stop();
	try { GlobalShortcut.unregisterAll(); } catch {}
	try { controlsWin.close(); } catch {}
});
controlsWin.on("close", () => {
	try { renderWin.close(); } catch {}
});

import Electrobun, {
	ApplicationMenu,
	BrowserView,
	BrowserWindow,
	GlobalShortcut,
	Utils,
} from "electrobun/bun";
import { WGPUView } from "electrobun/bun";
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
import type {} from "@atcute/atproto";
import { PlcDidDocumentResolver } from "@atcute/identity-resolver";
import { Client, ok, simpleFetchHandler } from "@atcute/client";
import { createRenderer } from "./gpu/renderer";
import { createTransitionRig } from "./gpu/transition";
import { PipelineCache } from "./engine/pipeline-cache";
import { TransitionController } from "./engine/transitions";
import { FeatureSmoother } from "./engine/feature-smoother";
import { UniformWriter } from "./engine/uniform-writer";
import { createRenderDriver } from "./engine/render-frame";
import { loadWindowPrefs, WindowPrefsManager } from "./window-prefs";
import { preventSleep, allowSleep } from "./power";
import type { AudioSource, AutoSettings, ControlsRPC } from "../shared/rpc-types";

if (!existsSync(USER_PACKS_DIR)) mkdirSync(USER_PACKS_DIR, { recursive: true });

// ---------- Constants ----------

const REGISTRY_URL = process.env.CATNIP_REGISTRY_URL ?? "https://catnip.nickthesick.com";
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

// Resolve the initial active pack from persisted preferences.
// With no built-in packs, this is null until the user installs a pack.
const initialActiveId = getPref<string>("active.pack.id", "");
const initialActiveSlug = getPref<string>("active.pack.slug", "");
const initialActive: import("./packs/loader").Pack | null =
	registry.byId(initialActiveId) ??
	(initialActiveSlug ? registry.bySlug(initialActiveSlug) : undefined) ??
	registry.list()[0] ?? null;

const autoSettings: AutoSettings = {
	enabled: getPref<boolean>("auto.enabled", false),
	seconds: getPref<number>("auto.seconds", 30),
	shuffle: getPref<boolean>("auto.shuffle", true),
};

console.log(`[packs] active: ${initialActive?.name ?? "(none)"}`);

const savedAudioSource = getPref<AudioSource>("audio.source", "system");
const savedRenderScale = getPref<number>("render.scale", 1.0);

const audioBuffer = new RingBuffer(RING_SIZE);
const audioAnalyzer = new AudioAnalyzer(audioBuffer, 48000, FFT_SIZE);
const capture = new AudioCapture(audioBuffer);

capture.onStatusChange((status, detail) => {
	console.log(`[audio] status=${status}${detail ? ` (${detail})` : ""}`);
	if (status === "capturing") audioAnalyzer.sampleRate = capture.sampleRate;
	try {
		win.webview?.rpc?.send?.audioStatus({ status, detail });
	} catch {}
});

// ---------- RPC ----------

const rpc = BrowserView.defineRPC<ControlsRPC>({
	maxRequestTime: 10000,
	handlers: {
		requests: {
			getInitialState: () => ({
				collapsed: windowPrefs.sidebarCollapsed,
				audioStatus: capture.status,
				audioSource: capture.source,
				packs: registry.allPackInfos(),
				activePackId: transitions.getActiveId(),
				auto: transitions.getAutoSettings(),
				renderScale: currentRenderScale,
				registryUrl: registryProxyUrl,
			}),
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
					const newPack = registry.byId(r.id);
					if (newPack) {
						transitions.request(newPack);
						try { win.webview?.rpc?.send?.packInstalled({ name: newPack.name }); } catch {}
					}
					return { ok: true, id: r.id };
				} catch (err) {
					return { ok: false, error: String(err) };
				}
			},
			importPackBytes: async ({ fileName, bytesB64 }) => {
				// Drag-drop entry point. WKWebView doesn't expose dropped file paths,
				// so the webview reads bytes and sends them over RPC; we stage to a
				// temp .viz and reuse the existing extractor.
				const safeBase = (fileName || "drop.viz").replace(/[^a-z0-9._-]/gi, "_");
				const stagePath = join(tmpdir(), `viz-drop-${process.pid}-${Date.now()}-${safeBase}`);
				try {
					const bytes = Buffer.from(bytesB64, "base64");
					writeFileSync(stagePath, bytes);
					const r = importVizFile(stagePath, USER_PACKS_DIR);
					if (!r.ok) return { ok: false, error: r.error };
					await reloadAfterImport();
					const newPack = registry.byId(r.id);
					if (newPack) {
						transitions.request(newPack);
						try { win.webview?.rpc?.send?.packInstalled({ name: newPack.name }); } catch {}
					}
					return { ok: true, id: r.id };
				} catch (err) {
					return { ok: false, error: String(err) };
				} finally {
					try { unlinkSync(stagePath); } catch {}
				}
			},
		installFromRegistry: async ({ did, slug }) => {
			try {
				const bytes = await downloadViz(did, slug);
				const stagePath = join(tmpdir(), `viz-registry-${process.pid}-${Date.now()}-${slug}.viz`);
				writeFileSync(stagePath, bytes);
				try {
					const r = importVizFile(stagePath, USER_PACKS_DIR);
					if (!r.ok) return { ok: false, error: r.error };
					await reloadAfterImport();
					const newPack = registry.byId(r.id);
					if (newPack) {
						transitions.request(newPack);
						try { win.webview?.rpc?.send?.packInstalled({ name: newPack.name }); } catch {}
					}
					return { ok: true, id: r.id };
				} finally {
					try { unlinkSync(stagePath); } catch {}
				}
			} catch (err) {
				return { ok: false, error: String(err) };
			}
		},
		installAllFromUser: async ({ did }) => {
			const errors: string[] = [];
			let installed = 0;
			try {
				// Fetch the user's pack list from the registry
				const resp = await fetch(`${REGISTRY_URL}/api/users/${encodeURIComponent(did)}/packs`);
				if (!resp.ok) {
					return { ok: false, installed: 0, errors: [`Failed to fetch user packs: ${resp.status}`] };
				}
				const data = (await resp.json()) as { did: string; packs: { did: string; slug: string; name: string }[] };
				if (data.packs.length === 0) {
					return { ok: true, installed: 0, errors: [] };
				}

				// Install each pack sequentially
				for (const pack of data.packs) {
					try {
						const bytes = await downloadViz(pack.did, pack.slug);
						const stagePath = join(tmpdir(), `viz-batch-${process.pid}-${Date.now()}-${pack.slug}.viz`);
						writeFileSync(stagePath, bytes);
						try {
							const r = importVizFile(stagePath, USER_PACKS_DIR);
							if (!r.ok) {
								errors.push(`${pack.name}: ${r.error}`);
								continue;
							}
							installed++;
						} finally {
							try { unlinkSync(stagePath); } catch {}
						}
					} catch (err) {
						errors.push(`${pack.name}: ${String(err)}`);
					}
				}

				// Reload once after all imports
				if (installed > 0) {
					await reloadAfterImport();
					try { win.webview?.rpc?.send?.packInstalled({ name: `${installed} pack${installed !== 1 ? "s" : ""}` }); } catch {}
				}

				return { ok: errors.length === 0, installed, errors };
			} catch (err) {
				return { ok: false, installed, errors: [...errors, String(err)] };
			}
		},
		exportPack: async ({ id }) => {
			try {
				const pack = registry.byId(id);
				if (!pack) return { ok: false, error: "unknown pack" };
				const safeName = pack.name.replace(/[^a-z0-9._-]/gi, "_");
				// Create a .viz (zip) from the pack directory and write to Downloads
				const { readdirSync, readFileSync } = await import("fs");
				const { relative } = await import("path");
				const { homedir } = await import("os");
				const fflate = await import("fflate");
				const entries: Record<string, Uint8Array> = {};
				const files = readdirSync(pack.path, { recursive: true, withFileTypes: true });
				for (const f of files) {
					if (!f.isFile()) continue;
					const full = join(f.parentPath, f.name);
					const rel = relative(pack.path, full);
					entries[rel] = readFileSync(full);
				}
				const zipped = fflate.zipSync(entries, { level: 6 });
				const downloadsDir = join(homedir(), "Downloads");
				const savePath = join(downloadsDir, `${safeName}.viz`);
				writeFileSync(savePath, zipped);
			// Reveal the exported file in Finder
			Bun.spawn(["open", "-R", savePath]);
			return { ok: true };
		} catch (err) {
			return { ok: false, error: String(err) };
		}
	},
	},
	messages: {
			wgpuViewReady: ({ viewId }) => {
				console.log(`[wgpu] view ready: id=${viewId}`);
				void initEngine(viewId);
			},
			setCollapsed: ({ collapsed }) => windowMgr.setSidebarCollapsed(collapsed, false),
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
				pipelineCache?.invalidate(id);
				void reloadAfterImport();
			},
			setPackParameter: ({ packId, name, value }) => {
				registry.setParameter(packId, name, value);
			},
			setAudioSource: ({ source }) => {
				if (source !== "system" && source !== "mic") return;
				if (source === capture.source) return;
				setPref("audio.source", source);
				void capture.switchSource(source);
				try {
					win.webview?.rpc?.send?.audioSourceChanged({ source });
				} catch {}
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
			resetPackParams: ({ id }) => {
				registry.resetParams(id);
				broadcastPacksChanged();
			},
			revealPack: ({ id }) => {
				const pack = registry.byId(id);
				if (!pack) return;
				try {
					Bun.spawn(["open", pack.path]);
				} catch (err) {
					console.warn("[packs] failed to reveal pack:", err);
				}
			},
			setPackFavorite: ({ id, favorited }) => {
				registry.setFavorite(id, favorited);
				broadcastPacksChanged();
			},
			setRenderScale: ({ scale }) => {
				const clamped = Math.max(0.1, Math.min(1.0, scale));
				currentRenderScale = clamped;
				setPref("render.scale", clamped);
				activeRenderer?.setRenderScale(clamped);
			},
			debugLog: ({ level, args }) => {
				console.log(`[webview:${level}]`, args);
			},
		},
	},
});

function persistActivePack(id: string | null): void {
	if (!id) return;
	setPref("active.pack.id", id);
	const p = registry.byId(id);
	if (p) setPref("active.pack.slug", p.name);
}

async function reloadAfterImport(): Promise<void> {
	const fresh = await registry.reload();
	if (transitions.rebindActive(fresh)) {
		persistActivePack(transitions.getActiveId());
	}
	broadcastPacksChanged();
}

function broadcastPacksChanged(): void {
	try {
		win.webview?.rpc?.send?.packsChanged({
			packs: registry.allPackInfos(),
			activePackId: transitions.getActiveId(),
		});
	} catch {}
}

// ---------- Window ----------

const win = new BrowserWindow({
	title: "Cat Nip",
	url: "views://mainview/index.html",
	frame: windowPrefs.windowBounds,
	titleBarStyle: "hiddenInset",
	transparent: false,
	rpc,
});

const windowMgr = new WindowPrefsManager(
	windowPrefs,
	win,
	(collapsed) => {
		try { win.webview?.rpc?.send?.collapsedChanged({ collapsed }); } catch {}
	},
);

// ---------- View toggles (menu / global shortcut) ----------

ApplicationMenu.setApplicationMenu([
	{ label: "Cat Nip", submenu: [{ role: "quit" }] },
	{
		label: "View",
		submenu: [
			{ label: "Toggle Sidebar", action: "toggleSidebar", accelerator: "CommandOrControl+Shift+H" },
			{ label: "Toggle Fullscreen", action: "toggleFullscreen", accelerator: "CommandOrControl+Control+F" },
		],
	},
]);

ApplicationMenu.on("application-menu-clicked", (event: unknown) => {
	const action = (event as { action?: string } | undefined)?.action;
	if (action === "toggleSidebar") windowMgr.toggleCollapsed();
	else if (action === "toggleFullscreen") windowMgr.toggleFullscreen();
});

const SHORTCUT = "CommandOrControl+Shift+H";
if (!GlobalShortcut.register(SHORTCUT, () => windowMgr.toggleCollapsed())) {
	console.warn(`[viz] failed to register global shortcut ${SHORTCUT}`);
}

// ---------- Transition controller (needs to exist before RPC handlers fire) ----------

const transitions = new TransitionController(initialActive, autoSettings, {
	getPacks: () => registry.list(),
	ensurePipeline: (p) => pipelineCache?.ensure(p) ?? null,
	onActivePackChanged: (id) => {
		persistActivePack(id);
		try { win.webview?.rpc?.send?.activePackChanged({ id }); } catch {}
	},
});

registry.onChange(broadcastPacksChanged);

// ---------- Registry reverse proxy ----------
// The webview loads from views:// scheme; WKWebView blocks cross-origin fetch.
// We spin up a tiny local HTTP server that reverse-proxies to the registry,
// so the webview can use plain fetch() and <img src> without CORS issues.

let registryProxyUrl = "";

try {
	const corsHeaders = {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	} as const;

	const proxyServer = Bun.serve({
		port: 0, // OS-assigned ephemeral port
		async fetch(req) {
			// Handle CORS preflight
			if (req.method === "OPTIONS") {
				return new Response(null, { status: 204, headers: corsHeaders });
			}
			const url = new URL(req.url);
			const upstream = `${REGISTRY_URL}${url.pathname}${url.search}`;
			try {
				const resp = await fetch(upstream);
				// Buffer the body to avoid streaming issues between fetch and serve
				const body = await resp.arrayBuffer();
				const headers = new Headers(resp.headers);
				for (const [k, v] of Object.entries(corsHeaders)) headers.set(k, v);
				return new Response(body, {
					status: resp.status,
					statusText: resp.statusText,
					headers,
				});
			} catch (err) {
				return new Response(String(err), { status: 502, headers: corsHeaders });
			}
		},
	});
	registryProxyUrl = `http://localhost:${proxyServer.port}`;
	console.log(`[registry] proxy at ${registryProxyUrl}`);
} catch (err) {
	console.error("[registry] failed to start proxy:", err);
}

// ---------- Deferred engine init (waits for <electrobun-wgpu> ready) ----------

let pipelineCache: PipelineCache | null = null;
let stopRenderLoop = false;
let activeRenderer: import("./gpu/renderer").Renderer | null = null;
let currentRenderScale = savedRenderScale;

async function initEngine(wgpuViewId: number): Promise<void> {
	const wgpuView = WGPUView.getById(wgpuViewId);
	if (!wgpuView) {
		console.error(`[wgpu] WGPUView.getById(${wgpuViewId}) returned undefined`);
		return;
	}

	// Pack pipeline self-test mode (used by `bun run test:gpu`).
	const isSelfTest = process.env["VIZ_PACKS_SELFTEST"] === "1";

	const renderer = await createRenderer(wgpuView);
	activeRenderer = renderer;
	renderer.setRenderScale(currentRenderScale);

	const transitionRig = createTransitionRig(renderer);
	{
		const initSize = renderer.getSize();
		transitionRig.setSize(initSize.width, initSize.height);
	}

	pipelineCache = new PipelineCache(
		renderer,
		transitionRig,
		UNIFORM_BUFFER_SIZE,
		() => transitions.pinnedIds(),
	);

	// Re-wire the transition controller's ensurePipeline now that the cache exists.
	transitions.setCallbacks({
		getPacks: () => registry.list(),
		ensurePipeline: (p) => pipelineCache!.ensure(p),
		onActivePackChanged: (id) => {
			persistActivePack(id);
			try { win.webview?.rpc?.send?.activePackChanged({ id }); } catch {}
		},
	});

	if (isSelfTest) {
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
		process.exit(buildFails > 0 ? 1 : 0);
	}

	// Pre-build the active pack's pipeline so the first frame doesn't stall.
	if (initialActive) pipelineCache.ensure(initialActive);
	console.log("[visualizer] pipeline ready, surfaceFormat=" + renderer.surfaceFormat);
	void capture.start(savedAudioSource);
	transitions.rescheduleAutoTimer();
	preventSleep();

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
			try { win.webview?.rpc?.send?.audioLevel({ rms, peak }); } catch {}
		},
	});

	// Render-error surfacing: log once per ~5s window and push a banner to the
	// controls UI so silent stalls are visible.
	const RENDER_ERROR_THROTTLE_MS = 5000;
	let lastRenderErrorAt = 0;
	function reportRenderError(err: unknown): void {
		const now = performance.now();
		if (now - lastRenderErrorAt < RENDER_ERROR_THROTTLE_MS) return;
		lastRenderErrorAt = now;
		const message = err instanceof Error ? err.message : String(err);
		console.error("[visualizer] render error:", err);
		try {
			win.webview?.rpc?.send?.renderError({ message });
		} catch {}
	}

	// Frame-paced render loop: targets ~60fps using setImmediate for tight
	// scheduling. PresentMode_Mailbox makes surfacePresent non-blocking —
	// the GPU picks the latest submitted frame at its own vsync. We pace
	// on the CPU side to avoid busy-spinning at hundreds of fps.
	const TARGET_FRAME_MS = 16;
	let nextFrameTime = performance.now();
	function tickRenderLoop(): void {
		if (stopRenderLoop) return;
		const now = performance.now();
		if (now < nextFrameTime) {
			// Not time yet — yield briefly and retry. setTimeout(,1) gives
			// ~1ms granularity which is fine for the last-mile wait.
			setTimeout(tickRenderLoop, 1);
			return;
		}
		// Advance the target by one frame period. If we overshot (e.g. a
		// long frame), snap forward so we don't try to "catch up" with a
		// burst of frames.
		nextFrameTime += TARGET_FRAME_MS;
		if (nextFrameTime < now) nextFrameTime = now + TARGET_FRAME_MS;
		try {
			renderDriver();
		} catch (err) {
			reportRenderError(err);
		}
		if (stopRenderLoop) return;
		// Use setImmediate for the next iteration — it fires on the next
		// event-loop turn with no minimum delay (unlike setTimeout's ~1ms).
		setImmediate(tickRenderLoop);
	}
	tickRenderLoop();
}

// ---------- Lifecycle ----------

win.on("close", () => {
	stopRenderLoop = true;
	transitions.stop();
	capture.stop();
	allowSleep();
	try { GlobalShortcut.unregisterAll(); } catch {}
});

// ---------- PDS-direct fallback ----------

const plcResolver = new PlcDidDocumentResolver();

async function resolvePdsEndpoint(did: string): Promise<string> {
	try {
		const doc = await plcResolver.resolve(did as `did:plc:${string}`);
		const pds = doc.service?.find(
			(s) => s.id === "#atproto_pds" || s.id === `${did}#atproto_pds`,
		);
		if (pds?.serviceEndpoint) return pds.serviceEndpoint as string;
	} catch (err) {
		console.warn(`[install] failed to resolve PDS for ${did}:`, err);
	}
	return "https://bsky.social";
}

async function downloadFromPds(did: string, slug: string): Promise<Uint8Array> {
	const pdsEndpoint = await resolvePdsEndpoint(did);
	const client = new Client({
		handler: simpleFetchHandler({ service: pdsEndpoint }),
	});

	const releaseUri = `at://${did}/com.nickthesick.catnip.release/${slug}`;

	type PackRecord = { release: string; version: string; viz: { ref: { $link: string } }; createdAt: string };
	type Did = `did:${string}:${string}`;

	const listData = await ok(
		client.get("com.atproto.repo.listRecords", {
			params: {
				repo: did as Did,
				collection: "com.nickthesick.catnip.pack",
				limit: 100,
			},
		}),
	);

	const matching = listData.records
		.filter((r) => (r.value as PackRecord).release === releaseUri)
		.sort((a, b) => {
			const ta = (a.value as PackRecord).createdAt;
			const tb = (b.value as PackRecord).createdAt;
			return tb.localeCompare(ta);
		});

	if (matching.length === 0) {
		throw new Error(`No versions found for ${slug} by ${did}`);
	}

	const latest = matching[0].value as PackRecord;
	const vizCid = latest.viz.ref.$link;

	const bytes = await ok(
		client.get("com.atproto.sync.getBlob", {
			params: { did: did as Did, cid: vizCid },
			as: "bytes",
		}),
	);

	return bytes;
}

async function downloadViz(did: string, slug: string): Promise<Uint8Array> {
	const downloadUrl = `${REGISTRY_URL}/api/packs/${encodeURIComponent(did)}/${encodeURIComponent(slug)}/download`;

	try {
		const resp = await fetch(downloadUrl);
		if (resp.ok) {
			return new Uint8Array(await resp.arrayBuffer());
		}
		console.warn(`[install] registry download failed (${resp.status}), trying PDS fallback...`);
	} catch (err) {
		console.warn(`[install] registry unreachable (${err}), trying PDS fallback...`);
	}

	// Fallback: fetch directly from the author's PDS
	return downloadFromPds(did, slug);
}

// ---------- Deep links (catnip://install/<did>/<slug>) ----------

Electrobun.events.on("open-url", (e: { data: { url: string } }) => {
	const url = new URL(e.data.url);
	if (url.protocol !== "catnip:") return;

	// catnip://install/... parses "install" as hostname, so reconstruct the full path
	const pathname = "/" + url.hostname + url.pathname;

	// catnip://install-all/<did>
	const installAllMatch = pathname.match(/^\/install-all\/([^/]+)$/);
	if (installAllMatch) {
		const [, did] = installAllMatch;
		console.log(`[deeplink] install-all request: did=${did}`);

		fetch(`${REGISTRY_URL}/api/users/${encodeURIComponent(did)}/packs`)
			.then(async (resp) => {
				if (!resp.ok) {
					console.error(`[deeplink] install-all: failed to fetch packs (${resp.status})`);
					return;
				}
				const data = (await resp.json()) as { did: string; packs: { did: string; slug: string; name: string }[] };
				if (data.packs.length === 0) {
					console.log("[deeplink] install-all: no packs found");
					return;
				}

				let installed = 0;
				for (const pack of data.packs) {
					try {
						const bytes = await downloadViz(pack.did, pack.slug);
						const stagePath = join(tmpdir(), `viz-deeplink-batch-${process.pid}-${Date.now()}-${pack.slug}.viz`);
						writeFileSync(stagePath, bytes);
						try {
							const r = importVizFile(stagePath, USER_PACKS_DIR);
							if (!r.ok) {
								console.error(`[deeplink] install-all: import failed for ${pack.slug}: ${r.error}`);
								continue;
							}
							installed++;
						} finally {
							try { unlinkSync(stagePath); } catch {}
						}
					} catch (err) {
						console.error(`[deeplink] install-all: error installing ${pack.slug}:`, err);
					}
				}

				if (installed > 0) {
					await reloadAfterImport();
					try { win.webview?.rpc?.send?.packInstalled({ name: `${installed} pack${installed !== 1 ? "s" : ""}` }); } catch {}
				}
				console.log(`[deeplink] install-all: installed ${installed}/${data.packs.length} packs`);
			})
			.catch((err) => {
				console.error("[deeplink] install-all error:", err);
			});
		return;
	}

	// catnip://install/<did>/<slug>
	const installMatch = pathname.match(/^\/install\/([^/]+)\/([^/]+)$/);
	if (!installMatch) {
		console.warn(`[deeplink] unrecognized catnip URL: ${e.data.url}`);
		return;
	}

	const [, did, slug] = installMatch;
	console.log(`[deeplink] install request: did=${did} slug=${slug}`);

	// Trigger the install flow (registry first, PDS fallback)
	downloadViz(did, slug)
		.then(async (bytes) => {
			const stagePath = join(tmpdir(), `viz-deeplink-${process.pid}-${Date.now()}-${slug}.viz`);
			writeFileSync(stagePath, bytes);
			try {
				const r = importVizFile(stagePath, USER_PACKS_DIR);
				if (!r.ok) {
					console.error(`[deeplink] import failed: ${r.error}`);
					return;
				}
				await reloadAfterImport();
				const newPack = registry.byId(r.id);
				if (newPack) {
					transitions.request(newPack);
					try { win.webview?.rpc?.send?.packInstalled({ name: newPack.name }); } catch {}
				}
				console.log(`[deeplink] installed "${slug}" (${r.id})`);
			} finally {
				try { unlinkSync(stagePath); } catch {}
			}
		})
		.catch((err) => {
			console.error("[deeplink] install error:", err);
		});
});

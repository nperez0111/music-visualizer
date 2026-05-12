import Electrobun, { Electroview } from "electrobun/view";
import type {
	AudioSource,
	AutoSettings,
	CaptureStatus,
	ControlsRPC,
	PackInfo,
	PackParameter,
	ParamValue,
} from "../shared/rpc-types";

let currentAudioSource: AudioSource = "system";

function statusText(status: CaptureStatus): string {
	switch (status) {
		case "idle": return "idle";
		case "starting": return "starting…";
		case "capturing":
			return currentAudioSource === "mic" ? "capturing microphone" : "capturing system audio";
		case "permission-denied":
			return currentAudioSource === "mic"
				? "microphone permission required"
				: "system audio permission required";
		case "binary-missing": return "audiocap binary missing — run build:audiocap";
		case "error": return "capture error";
		default: return status;
	}
}

let lastLevel = 0;

const rpc = Electroview.defineRPC<ControlsRPC>({
	maxRequestTime: 10000,
	handlers: {
		requests: {},
		messages: {
			audioStatus: ({ status, detail }: { status: CaptureStatus; detail?: string }) => {
				updateStatus(status, detail);
			},
			audioSourceChanged: ({ source }: { source: AudioSource }) => {
				currentAudioSource = source;
				if (audioSourceSelect) audioSourceSelect.value = source;
			},
			audioLevel: ({ rms }: { rms: number; peak: number }) => {
				lastLevel = rms;
			},
			activePackChanged: ({ id }: { id: string | null }) => {
				currentPackId = id;
				renderPackList();
				renderParamsPanel();
			},
			packsChanged: ({ packs, activePackId }: { packs: PackInfo[]; activePackId: string | null }) => {
				populatePacks(packs, activePackId);
			},
			packInstalled: ({ name }: { name: string }) => {
				showToast(`Installed ${name}`);
			},
			collapsedChanged: ({ collapsed }: { collapsed: boolean }) => {
				applyCollapsed(collapsed);
			},
			renderError: ({ message }: { message: string }) => {
				showRenderError(message);
			},
		},
	},
});

const electrobun = new Electrobun.Electroview({ rpc });

// ---------- Debug log forwarding ----------
// Forward webview console to bun stdout via RPC so logs show in the terminal.
{
	const origLog = console.log;
	const origWarn = console.warn;
	const origError = console.error;
	const forward = (level: string, args: unknown[]) => {
		try {
			electrobun.rpc?.send?.debugLog({ level, args: args.map(a => {
				try { return typeof a === "string" ? a : JSON.stringify(a); }
				catch { return String(a); }
			}).join(" ") });
		} catch {}
	};
	console.log = (...args: unknown[]) => { origLog(...args); forward("log", args); };
	console.warn = (...args: unknown[]) => { origWarn(...args); forward("warn", args); };
	console.error = (...args: unknown[]) => { origError(...args); forward("error", args); };
}

// ---------- WGPU view initialization ----------

const wgpuTag = document.querySelector("electrobun-wgpu");
if (wgpuTag) {
	wgpuTag.on("ready", (event: CustomEvent) => {
		const viewId = (event.detail as { id: number }).id;
		electrobun.rpc?.send?.wgpuViewReady({ viewId });
	});
}

// ---------- DOM references ----------

const toggleBtn = document.getElementById("toggleBtn") as HTMLButtonElement;
const meterBar = document.getElementById("meterBar") as HTMLElement;
const audioStatusEl = document.getElementById("audioStatus") as HTMLElement;
const dotEl = document.querySelector(".dot") as HTMLElement;
const packList = document.getElementById("packList") as HTMLElement;
const packSearchRow = document.getElementById("packSearchRow");
const packSearch = document.getElementById("packSearch") as HTMLInputElement | null;
const importBtn = document.getElementById("importBtn") as HTMLButtonElement | null;
const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement | null;
const autoChk = document.getElementById("autoChk") as HTMLInputElement | null;
const autoSec = document.getElementById("autoSec") as HTMLInputElement | null;
const shuffleChk = document.getElementById("shuffleChk") as HTMLInputElement | null;
const paramsPanel = document.getElementById("paramsPanel") as HTMLElement;
const audioSourceSelect = document.getElementById("audioSourceSelect") as HTMLSelectElement | null;
const permFixBtn = document.getElementById("permFixBtn") as HTMLButtonElement | null;
const renderScaleSelect = document.getElementById("renderScaleSelect") as HTMLSelectElement | null;
const errorBanner = document.getElementById("errorBanner");
const toastEl = document.getElementById("toast");
const contextMenu = document.getElementById("contextMenu") as HTMLElement;
const confirmOverlay = document.getElementById("confirmOverlay") as HTMLElement;
const confirmMsg = document.getElementById("confirmMsg") as HTMLElement;
const confirmOk = document.getElementById("confirmOk") as HTMLButtonElement;
const confirmCancel = document.getElementById("confirmCancel") as HTMLButtonElement;

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function showToast(message: string, durationMs = 3000) {
	if (!toastEl) return;
	toastEl.textContent = message;
	toastEl.hidden = false;
	// Force reflow so the transition triggers
	void toastEl.offsetWidth;
	toastEl.classList.add("show");
	if (toastTimer) clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		toastEl.classList.remove("show");
		setTimeout(() => { toastEl.hidden = true; }, 300);
	}, durationMs);
}

let errorBannerTimer: ReturnType<typeof setTimeout> | null = null;
function showRenderError(message: string) {
	if (!errorBanner) return;
	errorBanner.textContent = `render error: ${message}`;
	errorBanner.hidden = false;
	requestAnimationFrame(() => wgpuTag?.syncDimensions(true));
	if (errorBannerTimer) clearTimeout(errorBannerTimer);
	errorBannerTimer = setTimeout(() => {
		if (errorBanner) {
			errorBanner.hidden = true;
			requestAnimationFrame(() => wgpuTag?.syncDimensions(true));
		}
	}, 8000);
}

let allPacks: PackInfo[] = [];
let currentPackId: string | null = null;

function applyCollapsed(collapsed: boolean) {
	document.documentElement.classList.toggle("collapsed", collapsed);
	toggleBtn.textContent = collapsed ? "\u25BD" : "\u25B3";
	toggleBtn.title = collapsed ? "Show controls" : "Hide controls";

	if (collapsed) {
		wgpuTag?.removeMaskSelector(".sidebar");
	} else {
		wgpuTag?.addMaskSelector(".sidebar");
	}
}

function updateStatus(status: CaptureStatus, detail?: string) {
	const text = statusText(status);
	if (audioStatusEl) {
		audioStatusEl.textContent = detail ? `${text} — ${detail}` : text;
		audioStatusEl.classList.toggle("muted", status !== "capturing");
	}
	const color =
		status === "capturing"
			? "#4ade80"
			: status === "starting"
				? "#fbbf24"
				: status === "permission-denied" || status === "binary-missing" || status === "error"
					? "#f87171"
					: "#9ca3af";
	if (dotEl) {
		dotEl.style.background = color;
		dotEl.style.boxShadow = `0 0 6px ${color}`;
	}
	if (permFixBtn) permFixBtn.hidden = status !== "permission-denied";
}

if (audioSourceSelect) {
	audioSourceSelect.addEventListener("change", () => {
		const source = audioSourceSelect.value as AudioSource;
		currentAudioSource = source;
		electrobun.rpc?.send?.setAudioSource({ source });
	});
}

if (permFixBtn) {
	permFixBtn.addEventListener("click", () => {
		electrobun.rpc?.send?.openScreenCapturePrefs({});
	});
}

if (renderScaleSelect) {
	renderScaleSelect.addEventListener("change", () => {
		const scale = Number(renderScaleSelect.value) || 1;
		electrobun.rpc?.send?.setRenderScale({ scale });
	});
}

if (nextBtn) {
	nextBtn.addEventListener("click", () => {
		electrobun.rpc?.send?.nextPack({});
	});
}

function pushAutoSettings() {
	if (!autoChk || !autoSec || !shuffleChk) return;
	electrobun.rpc?.send?.setAutoSettings({
		enabled: autoChk.checked,
		seconds: Math.max(5, Number(autoSec.value) || 30),
		shuffle: shuffleChk.checked,
	});
}
autoChk?.addEventListener("change", pushAutoSettings);
shuffleChk?.addEventListener("change", pushAutoSettings);
autoSec?.addEventListener("change", pushAutoSettings);

function applyAutoSettings(s: AutoSettings) {
	if (autoChk) autoChk.checked = s.enabled;
	if (autoSec) autoSec.value = String(Math.max(5, s.seconds));
	if (shuffleChk) shuffleChk.checked = s.shuffle;
}

// ---------- Pack list rendering ----------

let searchQuery = "";

/** Sort packs: favorites first, then alphabetical. */
function sortedPacks(packs: PackInfo[]): PackInfo[] {
	return packs.slice().sort((a, b) => {
		const af = a.favorited ? 1 : 0;
		const bf = b.favorited ? 1 : 0;
		if (af !== bf) return bf - af; // favorites first
		return a.name.localeCompare(b.name);
	});
}

/** Filter packs by search query (name, author, tags, description). */
function filteredPacks(packs: PackInfo[], query: string): PackInfo[] {
	if (!query) return packs;
	const q = query.toLowerCase();
	return packs.filter((p) => {
		if (p.name.toLowerCase().includes(q)) return true;
		if (p.author?.toLowerCase().includes(q)) return true;
		if (p.description?.toLowerCase().includes(q)) return true;
		if (p.tags?.some((t) => t.toLowerCase().includes(q))) return true;
		return false;
	});
}

function renderPackList() {
	if (!packList) return;
	packList.innerHTML = "";
	const sorted = sortedPacks(allPacks);
	const visible = filteredPacks(sorted, searchQuery);

	if (visible.length === 0 && allPacks.length > 0) {
		const empty = document.createElement("div");
		empty.className = "pack-list-empty";
		empty.textContent = searchQuery ? "No packs match your search" : "No packs";
		packList.appendChild(empty);
		return;
	}

	for (const p of visible) {
		const item = document.createElement("div");
		item.className = "pack-item";
		item.dataset.packId = p.id;
		if (p.id === currentPackId) item.classList.add("active");
		if (p.runtimeBroken) item.classList.add("broken");

		// Favorite star
		const fav = document.createElement("span");
		fav.className = "pack-item-fav" + (p.favorited ? " favorited" : "");
		fav.textContent = p.favorited ? "\u2605" : "\u2606";
		fav.title = p.favorited ? "Remove from favorites" : "Add to favorites";
		fav.addEventListener("click", (e) => {
			e.stopPropagation();
			electrobun.rpc?.send?.setPackFavorite({ id: p.id, favorited: !p.favorited });
		});
		item.appendChild(fav);

		// Name + metadata
		const info = document.createElement("div");
		info.className = "pack-item-info";
		const nameEl = document.createElement("span");
		nameEl.className = "pack-item-name";
		nameEl.textContent = p.runtimeBroken ? `${p.name} \u26A0` : p.name;
		info.appendChild(nameEl);

		const metaParts: string[] = [];
		if (p.author) metaParts.push(p.author);
		if (p.version) metaParts.push(`v${p.version}`);
		if (metaParts.length > 0) {
			const meta = document.createElement("span");
			meta.className = "pack-item-meta";
			meta.textContent = metaParts.join(" \u00B7 ");
			info.appendChild(meta);
		}
		item.appendChild(info);

		// Context menu button (three dots)
		const more = document.createElement("span");
		more.className = "pack-item-more";
		more.textContent = "\u22EF";
		more.title = "Actions";
		more.addEventListener("click", (e) => {
			e.stopPropagation();
			openContextMenu(p, e as MouseEvent);
		});
		item.appendChild(more);

		// Click to activate
		item.addEventListener("click", () => {
			if (p.runtimeBroken) return;
			electrobun.rpc?.send?.setActivePack({ id: p.id });
			currentPackId = p.id;
			renderPackList();
			renderParamsPanel();
		});

		// Right-click context menu
		item.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			openContextMenu(p, e as MouseEvent);
		});

		packList.appendChild(item);
	}
}

function populatePacks(packs: PackInfo[], activeId: string | null) {
	allPacks = packs;
	currentPackId = activeId;

	const emptyState = document.getElementById("emptyState");
	const packSection = document.querySelector(".pack-section") as HTMLElement | null;
	const autoRow = document.querySelector(".auto-row") as HTMLElement | null;

	if (packs.length === 0) {
		if (emptyState) emptyState.hidden = false;
		if (packSection) packSection.hidden = true;
		if (autoRow) autoRow.hidden = true;
		if (nextBtn) nextBtn.hidden = true;
		packList.innerHTML = "";
		paramsPanel.hidden = true;
		if (document.documentElement.classList.contains("collapsed")) {
			applyCollapsed(false);
			electrobun.rpc?.send?.setCollapsed({ collapsed: false });
		}
		requestAnimationFrame(() => wgpuTag?.syncDimensions(true));
		return;
	}

	if (emptyState) emptyState.hidden = true;
	if (packSection) packSection.hidden = false;
	if (autoRow) autoRow.hidden = false;
	if (nextBtn) nextBtn.hidden = false;
	// Show search when there are enough packs to make it useful
	if (packSearchRow) packSearchRow.hidden = packs.length < 4;

	renderPackList();
	renderParamsPanel();
	requestAnimationFrame(() => wgpuTag?.syncDimensions(true));
}

// ---------- Pack search ----------

if (packSearch) {
	packSearch.addEventListener("input", () => {
		searchQuery = packSearch.value.trim();
		renderPackList();
	});
}

// ---------- Context menu ----------

let contextPackId: string | null = null;

function openContextMenu(pack: PackInfo, e: MouseEvent) {
	contextPackId = pack.id;

	// Update favorite button text
	const favBtn = contextMenu.querySelector('[data-action="favorite"]');
	if (favBtn) {
		const icon = favBtn.querySelector(".context-icon");
		if (icon) icon.textContent = pack.favorited ? "\u2605" : "\u2606";
		favBtn.childNodes[favBtn.childNodes.length - 1].textContent =
			pack.favorited ? " Unfavorite" : " Favorite";
	}

	// Position menu near click
	contextMenu.hidden = false;
	const rect = contextMenu.getBoundingClientRect();
	let x = e.clientX;
	let y = e.clientY;
	// Keep within viewport
	if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
	if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
	contextMenu.style.left = `${x}px`;
	contextMenu.style.top = `${y}px`;
	wgpuTag?.syncDimensions(true);
}

function closeContextMenu() {
	contextMenu.hidden = true;
	contextPackId = null;
	wgpuTag?.syncDimensions(true);
}

// Close context menu on any outside click or Escape
document.addEventListener("click", () => closeContextMenu());
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		if (!browseOverlay.hidden) return; // browse overlay handles its own Escape
		closeContextMenu();
		closeConfirmDialog();
	}
});

// Handle context menu actions
contextMenu.addEventListener("click", (e) => {
	const btn = (e.target as HTMLElement).closest(".context-item") as HTMLElement | null;
	if (!btn || !contextPackId) return;
	e.stopPropagation();
	const action = btn.dataset.action;
	if (!action) return;
	const packId = contextPackId;
	closeContextMenu();

	switch (action) {
		case "favorite": {
			const pack = allPacks.find((p) => p.id === packId);
			if (pack) electrobun.rpc?.send?.setPackFavorite({ id: packId, favorited: !pack.favorited });
			break;
		}
		case "resetParams":
			electrobun.rpc?.send?.resetPackParams({ id: packId });
			break;
		case "export":
			void electrobun.rpc?.request?.exportPack({ id: packId }).then((r) => {
				if (r?.ok) showToast("Exported to Downloads");
				else if (r?.error) showToast(`Export failed: ${r.error}`);
			});
			break;
		case "reveal":
			electrobun.rpc?.send?.revealPack({ id: packId });
			break;
		case "remove":
			showRemoveConfirm(packId);
			break;
		default:
			break;
	}
});

// ---------- Confirm dialog ----------

let confirmCallback: (() => void) | null = null;

function showRemoveConfirm(packId: string) {
	const pack = allPacks.find((p) => p.id === packId);
	if (!pack) return;
	confirmMsg.textContent = `Remove "${pack.name}"? This will delete the pack from your library.`;
	confirmOverlay.hidden = false;
	wgpuTag?.syncDimensions(true);
	confirmCallback = () => {
		electrobun.rpc?.send?.removePack({ id: packId });
	};
}

function closeConfirmDialog() {
	confirmOverlay.hidden = true;
	confirmCallback = null;
	wgpuTag?.syncDimensions(true);
}

confirmOk.addEventListener("click", () => {
	if (confirmCallback) confirmCallback();
	closeConfirmDialog();
});
confirmCancel.addEventListener("click", () => closeConfirmDialog());
confirmOverlay.addEventListener("click", (e) => {
	if (e.target === confirmOverlay) closeConfirmDialog();
});

function rgbToHex(rgb: number[]): string {
	const c = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
	return `#${c(rgb[0] ?? 0)}${c(rgb[1] ?? 0)}${c(rgb[2] ?? 0)}`;
}

function hexToRgb(hex: string): [number, number, number] {
	const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!m) return [0, 0, 0];
	return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

function sendParam(packId: string, name: string, value: ParamValue) {
	electrobun.rpc?.send?.setPackParameter({ packId, name, value });
}

function buildWidget(packId: string, p: PackParameter, value: ParamValue): HTMLElement {
	const row = document.createElement("div");
	row.className = "row param-row";
	const label = document.createElement("span");
	label.className = "label";
	label.textContent = p.label ?? p.name;
	row.appendChild(label);

	const sliderInput = (init: number, min: number, max: number, step: number, onInput: (v: number) => void) => {
		const wrap = document.createElement("span");
		wrap.className = "param-slider";
		const input = document.createElement("input");
		input.type = "range";
		input.min = String(min);
		input.max = String(max);
		input.step = String(step);
		input.value = String(init);
		input.className = "slider";
		const valueEl = document.createElement("span");
		valueEl.className = "value";
		valueEl.textContent = init.toFixed(step < 1 ? 2 : 0);
		input.addEventListener("input", () => {
			const v = Number(input.value);
			valueEl.textContent = v.toFixed(step < 1 ? 2 : 0);
			onInput(v);
		});
		wrap.appendChild(input);
		wrap.appendChild(valueEl);
		return wrap;
	};

	switch (p.type) {
		case "float": {
			const v = typeof value === "number" ? value : p.default;
			row.appendChild(
				sliderInput(v, p.min, p.max, (p.max - p.min) / 200, (n) => sendParam(packId, p.name, n)),
			);
			break;
		}
		case "int": {
			const v = typeof value === "number" ? value : p.default;
			row.appendChild(
				sliderInput(v, p.min, p.max, 1, (n) => sendParam(packId, p.name, Math.round(n))),
			);
			break;
		}
		case "bool": {
			const v = typeof value === "boolean" ? value : p.default;
			const input = document.createElement("input");
			input.type = "checkbox";
			input.checked = v;
			input.className = "checkbox";
			input.addEventListener("change", () => sendParam(packId, p.name, input.checked));
			row.appendChild(input);
			break;
		}
		case "enum": {
			const v = typeof value === "string" && p.options.includes(value) ? value : p.default;
			const sel = document.createElement("select");
			sel.className = "select";
			for (const opt of p.options) {
				const o = document.createElement("option");
				o.value = opt;
				o.textContent = opt;
				if (opt === v) o.selected = true;
				sel.appendChild(o);
			}
			sel.addEventListener("change", () => sendParam(packId, p.name, sel.value));
			row.appendChild(sel);
			break;
		}
		case "color": {
			const v = Array.isArray(value) && value.length === 3 ? value : p.default;
			const input = document.createElement("input");
			input.type = "color";
			input.value = rgbToHex(v);
			input.className = "color-input";
			input.addEventListener("input", () => sendParam(packId, p.name, hexToRgb(input.value)));
			row.appendChild(input);
			break;
		}
		case "range": {
			const v = Array.isArray(value) && value.length === 2 ? value : p.default;
			const current = [v[0], v[1]];
			const cell = document.createElement("span");
			cell.className = "param-multi";
			cell.appendChild(
				sliderInput(current[0], p.min, p.max, (p.max - p.min) / 200, (n) => {
					current[0] = n;
					sendParam(packId, p.name, [...current]);
				}),
			);
			cell.appendChild(
				sliderInput(current[1], p.min, p.max, (p.max - p.min) / 200, (n) => {
					current[1] = n;
					sendParam(packId, p.name, [...current]);
				}),
			);
			row.appendChild(cell);
			break;
		}
		case "vec2":
		case "vec3":
		case "vec4": {
			const n = p.type === "vec2" ? 2 : p.type === "vec3" ? 3 : 4;
			const v = Array.isArray(value) && value.length === n ? value : (p.default as number[]);
			const current = v.slice();
			const cell = document.createElement("span");
			cell.className = "param-multi";
			for (let i = 0; i < n; i++) {
				cell.appendChild(
					sliderInput(current[i], -1, 1, 0.01, (val) => {
						current[i] = val;
						sendParam(packId, p.name, [...current]);
					}),
				);
			}
			row.appendChild(cell);
			break;
		}
	}
	return row;
}

function buildPresetRow(pack: PackInfo): HTMLElement {
	const row = document.createElement("div");
	row.className = "row param-row preset-row";
	const label = document.createElement("span");
	label.className = "label";
	label.textContent = "preset";
	row.appendChild(label);

	const sel = document.createElement("select");
	sel.className = "select";
	const placeholder = document.createElement("option");
	placeholder.value = "";
	placeholder.textContent = "\u2014";
	sel.appendChild(placeholder);
	for (const pr of pack.presets) {
		const opt = document.createElement("option");
		opt.value = pr.name;
		opt.textContent = pr.name;
		sel.appendChild(opt);
	}
	sel.addEventListener("change", () => {
		const name = sel.value;
		if (!name) return;
		electrobun.rpc?.send?.applyPreset({ packId: pack.id, presetName: name });
		// Drop back to the placeholder so picking the same preset again re-applies.
		sel.value = "";
	});
	row.appendChild(sel);
	return row;
}

function renderParamsPanel() {
	if (!paramsPanel) return;
	paramsPanel.innerHTML = "";
	const pack = allPacks.find((p) => p.id === currentPackId);
	if (!pack || (pack.parameters.length === 0 && pack.presets.length === 0)) {
		paramsPanel.hidden = true;
		requestAnimationFrame(() => wgpuTag?.syncDimensions(true));
		return;
	}
	paramsPanel.hidden = false;
	if (pack.presets.length > 0) {
		paramsPanel.appendChild(buildPresetRow(pack));
	}
	for (const param of pack.parameters) {
		paramsPanel.appendChild(buildWidget(pack.id, param, pack.parameterValues[param.name] ?? param.default));
	}
	requestAnimationFrame(() => wgpuTag?.syncDimensions(true));
}

// Pack activation is now handled by click handlers in renderPackList().

if (importBtn) {
	importBtn.addEventListener("click", async () => {
		importBtn.disabled = true;
		try {
			const r = await electrobun.rpc?.request?.importPack({});
			if (r && !r.ok && r.error && r.error !== "no file selected") {
				console.warn("[viz import]", r.error);
			}
		} finally {
			importBtn.disabled = false;
		}
	});
}

// ---------- Sidebar toggle ----------

const sidebarTab = document.getElementById("sidebarTab") as HTMLButtonElement | null;

toggleBtn.addEventListener("click", () => {
	const next = !document.documentElement.classList.contains("collapsed");
	applyCollapsed(next);
	electrobun.rpc?.send?.setCollapsed({ collapsed: next });
});

sidebarTab?.addEventListener("click", () => {
	applyCollapsed(false);
	electrobun.rpc?.send?.setCollapsed({ collapsed: false });
});

// ---------- Drag-drop .viz import ----------
// WKWebView doesn't expose dropped file paths to JS, so we read bytes in the
// webview and ship them to bun over RPC.

let dragDepth = 0;

function readFileAsBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
		reader.onload = () => {
			const result = reader.result;
			if (typeof result !== "string") {
				reject(new Error("unexpected reader result"));
				return;
			}
			const comma = result.indexOf(",");
			resolve(comma >= 0 ? result.slice(comma + 1) : result);
		};
		reader.readAsDataURL(file);
	});
}

window.addEventListener("dragenter", (e) => {
	e.preventDefault();
	dragDepth++;
	document.documentElement.classList.add("dropping");
});
window.addEventListener("dragover", (e) => {
	e.preventDefault();
	if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", (e) => {
	e.preventDefault();
	dragDepth = Math.max(0, dragDepth - 1);
	if (dragDepth === 0) document.documentElement.classList.remove("dropping");
});
window.addEventListener("drop", async (e) => {
	e.preventDefault();
	dragDepth = 0;
	document.documentElement.classList.remove("dropping");
	const files = e.dataTransfer?.files;
	if (!files || files.length === 0) return;
	const viz = Array.from(files).find((f) => f.name.toLowerCase().endsWith(".viz"));
	if (!viz) {
		console.warn("[viz import] dropped item is not a .viz file");
		return;
	}
	try {
		const bytesB64 = await readFileAsBase64(viz);
		const r = await electrobun.rpc?.request?.importPackBytes({
			fileName: viz.name,
			bytesB64,
		});
		if (r && !r.ok) console.warn("[viz import]", r.error);
	} catch (err) {
		console.warn("[viz import] drop failed", err);
	}
});

// ---------- Browse overlay ----------

const browseOverlay = document.getElementById("browseOverlay") as HTMLElement;
const browseCloseBtn = document.getElementById("browseCloseBtn") as HTMLButtonElement;
const browseSearch = document.getElementById("browseSearch") as HTMLInputElement;
const browseSortSelect = document.getElementById("browseSort") as HTMLSelectElement;
const browseTags = document.getElementById("browseTags") as HTMLElement;
const browseGrid = document.getElementById("browseGrid") as HTMLElement;
const browseDetail = document.getElementById("browseDetail") as HTMLElement;
const browseAuthor = document.getElementById("browseAuthor") as HTMLElement;
const browseEmpty = document.getElementById("browseEmpty") as HTMLElement;
const browseLoading = document.getElementById("browseLoading") as HTMLElement;
const browsePagination = document.getElementById("browsePagination") as HTMLElement;
const browsePrev = document.getElementById("browsePrev") as HTMLButtonElement;
const browseNext = document.getElementById("browseNext") as HTMLButtonElement;
const browsePageInfo = document.getElementById("browsePageInfo") as HTMLElement;
const browseBtn = document.getElementById("browseBtn") as HTMLButtonElement | null;
const emptyBrowseBtn = document.getElementById("emptyBrowseBtn") as HTMLButtonElement | null;

// Registry browse types -- kept in sync with the server API response shapes.
interface RegistryPack {
	did: string;
	rkey: string;
	name: string;
	slug: string;
	description: string | null;
	created_at: string;
	star_count: number;
	install_count: number;
	latest_version: string | null;
	preview_path: string | null;
}

interface RegistryPackDetail {
	release: {
		did: string;
		rkey: string;
		name: string;
		slug: string;
		description: string | null;
		created_at: string;
	};
	versions: Array<{
		version: string;
		changelog: string | null;
		preview_path: string | null;
		created_at: string;
	}>;
	stars: number;
	tags: string[];
	handle: string | null;
}

interface RegistryUser {
	did: string;
	handle: string | null;
	packCount: number;
	totalStars: number;
	packs: RegistryPack[];
}

/** Base URL for the registry reverse proxy running on the local Electrobun server. */
let registryUrl = "";

/** Fetch JSON from the registry API via the local reverse proxy. Returns null on failure. */
async function registryJson<T>(path: string): Promise<T | null> {
	try {
		const resp = await fetch(`${registryUrl}${path}`);
		if (!resp.ok) {
			console.warn(`[browse] fetch ${path} -> ${resp.status}`);
			return null;
		}
		return (await resp.json()) as T;
	} catch (err) {
		console.warn(`[browse] fetch ${path} error:`, err);
		return null;
	}
}

interface BrowseState {
	view: "grid" | "detail" | "author";
	search: string;
	sort: "newest" | "stars" | "installs";
	tag: string;
	offset: number;
	limit: number;
	packs: RegistryPack[];
	hasMore: boolean;
	tags: Array<{ tag: string; count: number }>;
	tagsLoaded: boolean;
	detailDid: string;
	detailSlug: string;
	authorDid: string;
	loading: boolean;
	installingSet: Set<string>; // "did/slug" keys currently being installed
}

const browseState: BrowseState = {
	view: "grid",
	search: "",
	sort: "newest",
	tag: "",
	offset: 0,
	limit: 24,
	packs: [],
	hasMore: false,
	tags: [],
	tagsLoaded: false,
	detailDid: "",
	detailSlug: "",
	authorDid: "",
	loading: false,
	installingSet: new Set(),
};

/** Check if a registry pack (by name) is already installed locally */
function isPackInstalled(name: string): boolean {
	return allPacks.some((p) => p.name === name);
}

let browseSearchTimer: ReturnType<typeof setTimeout> | null = null;

/** Build the preview image URL for a registry pack. */
function previewUrl(did: string, slug: string): string {
	return `${registryUrl}/api/packs/${did}/${encodeURIComponent(slug)}/preview.webp`;
}

async function loadBrowseTags() {
	if (browseState.tagsLoaded) return;
	const data = await registryJson<{ tags: Array<{ tag: string; count: number }> }>("/api/tags");
	if (data) {
		browseState.tags = data.tags;
		browseState.tagsLoaded = true;
		renderBrowseTags();
	}
}

async function loadBrowsePacks() {
	browseState.loading = true;
	renderBrowseLoadingState();

	const params = new URLSearchParams();
	if (browseState.search) params.set("search", browseState.search);
	if (browseState.tag) params.set("tag", browseState.tag);
	params.set("sort", browseState.sort);
	params.set("limit", String(browseState.limit));
	params.set("offset", String(browseState.offset));

	const data = await registryJson<{ packs: RegistryPack[] }>(`/api/packs?${params}`);
	browseState.loading = false;

	if (data) {
		browseState.packs = data.packs;
		browseState.hasMore = data.packs.length >= browseState.limit;
	} else {
		browseState.packs = [];
		browseState.hasMore = false;
	}

	renderBrowseGrid();
	renderBrowsePagination();
}

async function loadPackDetail(did: string, slug: string) {
	browseState.view = "detail";
	browseState.detailDid = did;
	browseState.detailSlug = slug;
	browseState.loading = true;
	renderBrowseViewState();

	const data = await registryJson<RegistryPackDetail>(
		`/api/packs/${did}/${encodeURIComponent(slug)}`,
	);
	browseState.loading = false;

	if (!data) {
		browseDetail.innerHTML = '<div class="browse-empty">Pack not found</div>';
		browseDetail.hidden = false;
		browseLoading.hidden = true;
		return;
	}

	renderBrowseDetail(data);
}

async function loadAuthorView(did: string) {
	browseState.view = "author";
	browseState.authorDid = did;
	browseState.loading = true;
	renderBrowseViewState();

	const data = await registryJson<RegistryUser>(`/api/users/${did}`);
	browseState.loading = false;

	if (!data) {
		browseAuthor.innerHTML = '<div class="browse-empty">Author not found</div>';
		browseAuthor.hidden = false;
		browseLoading.hidden = true;
		return;
	}

	renderBrowseAuthor(data);
}

function renderBrowseLoadingState() {
	browseLoading.textContent = "Loading...";
	browseLoading.hidden = false;
	browseGrid.hidden = true;
	browseDetail.hidden = true;
	browseAuthor.hidden = true;
	browseEmpty.hidden = true;
}

function renderBrowseViewState() {
	browseGrid.hidden = browseState.view !== "grid";
	browseDetail.hidden = browseState.view !== "detail";
	browseAuthor.hidden = browseState.view !== "author";
	browsePagination.hidden = browseState.view !== "grid";
	browseLoading.hidden = !browseState.loading;
	browseEmpty.hidden = true;
	// Scroll content to top when switching views
	const content = document.getElementById("browseContent");
	if (content) content.scrollTop = 0;
}

function renderBrowseTags() {
	browseTags.innerHTML = "";
	for (const t of browseState.tags) {
		const btn = document.createElement("button");
		btn.className = "browse-tag" + (browseState.tag === t.tag ? " active" : "");
		btn.textContent = t.tag;
		btn.title = `${t.count} pack${t.count !== 1 ? "s" : ""}`;
		btn.addEventListener("click", () => {
			browseState.tag = browseState.tag === t.tag ? "" : t.tag;
			browseState.offset = 0;
			browseState.view = "grid";
			renderBrowseTags();
			void loadBrowsePacks();
		});
		browseTags.appendChild(btn);
	}
}

function buildPackCard(p: RegistryPack): HTMLElement {
	const card = document.createElement("div");
	card.className = "browse-card";
	card.addEventListener("click", () => loadPackDetail(p.did, p.slug));

	// Preview image
	if (p.preview_path) {
		const img = document.createElement("img");
		img.className = "browse-card-preview";
		img.alt = p.name;
		img.src = previewUrl(p.did, p.slug);
		card.appendChild(img);
	} else {
		const ph = document.createElement("div");
		ph.className = "browse-card-preview-placeholder";
		ph.textContent = "\u2728";
		card.appendChild(ph);
	}

	const body = document.createElement("div");
	body.className = "browse-card-body";

	const name = document.createElement("div");
	name.className = "browse-card-name";
	name.textContent = p.name;
	body.appendChild(name);

	if (p.description) {
		const desc = document.createElement("div");
		desc.className = "browse-card-desc";
		desc.textContent = p.description;
		body.appendChild(desc);
	}

	const meta = document.createElement("div");
	meta.className = "browse-card-meta";

	if (p.star_count > 0) {
		const stars = document.createElement("span");
		stars.className = "browse-card-stat";
		stars.textContent = `\u2605 ${p.star_count}`;
		meta.appendChild(stars);
	}

	if (p.install_count > 0) {
		const installs = document.createElement("span");
		installs.className = "browse-card-stat";
		installs.textContent = `\u2913 ${p.install_count}`;
		meta.appendChild(installs);
	}

	if (p.latest_version) {
		const ver = document.createElement("span");
		ver.className = "browse-card-stat";
		ver.textContent = `v${p.latest_version}`;
		meta.appendChild(ver);
	}

	if (isPackInstalled(p.name)) {
		const badge = document.createElement("span");
		badge.className = "browse-card-installed";
		badge.textContent = "installed";
		meta.appendChild(badge);
	}

	body.appendChild(meta);
	card.appendChild(body);
	return card;
}

function renderBrowseGrid() {
	browseGrid.innerHTML = "";
	browseLoading.hidden = true;

	if (browseState.packs.length === 0) {
		browseGrid.hidden = true;
		browseEmpty.hidden = false;
		browseEmpty.textContent = browseState.search || browseState.tag
			? "No packs match your search"
			: "No packs available";
		return;
	}

	browseEmpty.hidden = true;
	browseGrid.hidden = false;
	for (const p of browseState.packs) {
		browseGrid.appendChild(buildPackCard(p));
	}
}

function renderBrowsePagination() {
	const page = Math.floor(browseState.offset / browseState.limit) + 1;
	browsePagination.hidden = browseState.view !== "grid" || (page === 1 && !browseState.hasMore);
	browsePrev.disabled = browseState.offset === 0;
	browseNext.disabled = !browseState.hasMore;
	browsePageInfo.textContent = `Page ${page}`;
}

function formatDate(iso: string): string {
	try {
		const d = new Date(iso);
		return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
	} catch {
		return iso;
	}
}

function renderBrowseDetail(data: RegistryPackDetail) {
	browseDetail.innerHTML = "";
	browseDetail.hidden = false;
	browseLoading.hidden = true;
	browseGrid.hidden = true;
	browseAuthor.hidden = true;
	browseEmpty.hidden = true;
	browsePagination.hidden = true;

	// Back button
	const back = document.createElement("button");
	back.className = "browse-back-btn";
	back.innerHTML = "&larr; Back";
	back.addEventListener("click", () => {
		browseState.view = "grid";
		renderBrowseViewState();
		renderBrowseGrid();
		renderBrowsePagination();
	});
	browseDetail.appendChild(back);

	// Header: preview + info
	const header = document.createElement("div");
	header.className = "browse-detail-header";

	const latestVersion = data.versions[0];
	if (latestVersion?.preview_path) {
		const img = document.createElement("img");
		img.className = "browse-detail-preview";
		img.alt = data.release.name;
		img.src = previewUrl(data.release.did, data.release.slug);
		header.appendChild(img);
	} else {
		const ph = document.createElement("div");
		ph.className = "browse-detail-preview-placeholder";
		ph.textContent = "\u2728";
		header.appendChild(ph);
	}

	const info = document.createElement("div");
	info.className = "browse-detail-info";

	const name = document.createElement("div");
	name.className = "browse-detail-name";
	name.textContent = data.release.name;
	info.appendChild(name);

	// Author link
	const author = document.createElement("div");
	author.className = "browse-detail-author";
	const authorLink = document.createElement("a");
	authorLink.className = "browse-detail-author-link";
	authorLink.textContent = data.handle ?? data.release.did;
	authorLink.addEventListener("click", (e) => {
		e.preventDefault();
		void loadAuthorView(data.release.did);
	});
	author.appendChild(authorLink);
	info.appendChild(author);

	// Stats
	const stats = document.createElement("div");
	stats.className = "browse-detail-stats";
	stats.textContent = `\u2605 ${data.stars} stars`;
	if (latestVersion) {
		stats.textContent += ` \u00B7 v${latestVersion.version}`;
	}
	stats.textContent += ` \u00B7 ${formatDate(data.release.created_at)}`;
	info.appendChild(stats);

	// Description
	if (data.release.description) {
		const desc = document.createElement("div");
		desc.className = "browse-detail-desc";
		desc.textContent = data.release.description;
		info.appendChild(desc);
	}

	// Tags
	if (data.tags.length > 0) {
		const tagsDiv = document.createElement("div");
		tagsDiv.className = "browse-detail-tags";
		for (const t of data.tags) {
			const tag = document.createElement("span");
			tag.className = "browse-tag";
			tag.textContent = t;
			tag.addEventListener("click", () => {
				browseState.tag = t;
				browseState.offset = 0;
				browseState.view = "grid";
				renderBrowseTags();
				void loadBrowsePacks();
			});
			tagsDiv.appendChild(tag);
		}
		info.appendChild(tagsDiv);
	}

	// Install button
	const actions = document.createElement("div");
	actions.className = "browse-detail-actions";
	const installBtn = document.createElement("button");
	installBtn.className = "browse-install-btn";
	const installed = isPackInstalled(data.release.name);
	const installKey = `${data.release.did}/${data.release.slug}`;
	const isInstalling = browseState.installingSet.has(installKey);

	installBtn.textContent = isInstalling ? "Installing..." : installed ? "Reinstall" : "Install";
	installBtn.disabled = isInstalling;
	installBtn.addEventListener("click", () => installRegistryPack(data.release.did, data.release.slug, data.release.name, installBtn));
	actions.appendChild(installBtn);
	info.appendChild(actions);

	header.appendChild(info);
	browseDetail.appendChild(header);

	// Version history
	if (data.versions.length > 0) {
		const versionsSection = document.createElement("div");
		versionsSection.className = "browse-versions";
		const versionsTitle = document.createElement("h3");
		versionsTitle.className = "browse-versions-title";
		versionsTitle.textContent = "Version History";
		versionsSection.appendChild(versionsTitle);

		for (const v of data.versions) {
			const item = document.createElement("div");
			item.className = "browse-version-item";

			const vHeader = document.createElement("div");
			vHeader.className = "browse-version-header";

			const vNum = document.createElement("span");
			vNum.className = "browse-version-number";
			vNum.textContent = v.version;
			vHeader.appendChild(vNum);

			const vDate = document.createElement("span");
			vDate.className = "browse-version-date";
			vDate.textContent = formatDate(v.created_at);
			vHeader.appendChild(vDate);

			item.appendChild(vHeader);

			if (v.changelog) {
				const changelog = document.createElement("div");
				changelog.className = "browse-version-changelog";
				changelog.textContent = v.changelog;
				item.appendChild(changelog);
			}

			versionsSection.appendChild(item);
		}

		browseDetail.appendChild(versionsSection);
	}

}

function renderBrowseAuthor(data: RegistryUser) {
	browseAuthor.innerHTML = "";
	browseAuthor.hidden = false;
	browseLoading.hidden = true;
	browseGrid.hidden = true;
	browseDetail.hidden = true;
	browseEmpty.hidden = true;
	browsePagination.hidden = true;

	// Back button
	const back = document.createElement("button");
	back.className = "browse-back-btn";
	back.innerHTML = "&larr; Back";
	back.addEventListener("click", () => {
		browseState.view = "grid";
		renderBrowseViewState();
		renderBrowseGrid();
		renderBrowsePagination();
	});
	browseAuthor.appendChild(back);

	// Author header
	const header = document.createElement("div");
	header.className = "browse-author-header";

	const nameBlock = document.createElement("div");
	const authorName = document.createElement("div");
	authorName.className = "browse-author-name";
	authorName.textContent = data.handle ?? data.did;
	nameBlock.appendChild(authorName);

	const authorStats = document.createElement("div");
	authorStats.className = "browse-author-stats";
	authorStats.textContent = `${data.packCount} pack${data.packCount !== 1 ? "s" : ""} \u00B7 ${data.totalStars} total stars`;
	nameBlock.appendChild(authorStats);
	header.appendChild(nameBlock);

	// Install all button
	if (data.packs.length > 1) {
		const installAllBtn = document.createElement("button");
		installAllBtn.className = "browse-install-btn browse-author-install-all";
		installAllBtn.textContent = "Install All";
		installAllBtn.addEventListener("click", async () => {
			installAllBtn.disabled = true;
			installAllBtn.textContent = "Installing...";
			try {
				const r = await electrobun.rpc?.request?.installAllFromUser({ did: data.did });
				if (r?.ok) {
					showToast(`Installed ${r.installed} pack${r.installed !== 1 ? "s" : ""}`);
				} else {
					showToast("Install failed");
				}
			} catch {
				showToast("Install failed");
			}
			installAllBtn.disabled = false;
			installAllBtn.textContent = "Install All";
		});
		header.appendChild(installAllBtn);
	}

	browseAuthor.appendChild(header);

	// Author's packs grid
	const packsGrid = document.createElement("div");
	packsGrid.className = "browse-author-packs";
	for (const p of data.packs) {
		packsGrid.appendChild(buildPackCard(p));
	}
	browseAuthor.appendChild(packsGrid);
}

async function installRegistryPack(did: string, slug: string, name: string, btn: HTMLButtonElement) {
	const key = `${did}/${slug}`;
	if (browseState.installingSet.has(key)) return;
	browseState.installingSet.add(key);
	btn.disabled = true;
	btn.textContent = "Installing...";

	try {
		const r = await electrobun.rpc?.request?.installFromRegistry({ did, slug });
		if (r?.ok) {
			showToast(`Installed ${name}`);
			btn.textContent = "Reinstall";
		} else {
			showToast(`Failed: ${r?.error ?? "unknown error"}`);
			btn.textContent = "Install";
		}
	} catch {
		showToast("Install failed");
		btn.textContent = "Install";
	}

	browseState.installingSet.delete(key);
	btn.disabled = false;

	// Re-render grid cards to update "installed" badges
	if (browseState.view === "grid") renderBrowseGrid();
}

function openBrowseOverlay() {
	browseOverlay.hidden = false;
	wgpuTag?.syncDimensions(true);

	// Reset to grid view
	browseState.view = "grid";
	browseState.offset = 0;
	browseSearch.value = browseState.search;
	browseSortSelect.value = browseState.sort;
	renderBrowseViewState();

	// Load data
	void loadBrowseTags();
	void loadBrowsePacks();
}

function closeBrowseOverlay() {
	browseOverlay.hidden = true;
	wgpuTag?.syncDimensions(true);
}

// Browse button handlers
browseBtn?.addEventListener("click", () => openBrowseOverlay());
emptyBrowseBtn?.addEventListener("click", () => openBrowseOverlay());

// Close button
browseCloseBtn.addEventListener("click", () => closeBrowseOverlay());

// Close on overlay background click
browseOverlay.addEventListener("click", (e) => {
	if (e.target === browseOverlay) closeBrowseOverlay();
});

// Escape key (only when browse overlay is open)
document.addEventListener("keydown", (e) => {
	if (e.key === "Escape" && !browseOverlay.hidden) {
		closeBrowseOverlay();
		e.stopPropagation();
	}
});

// Search with debounce
browseSearch.addEventListener("input", () => {
	if (browseSearchTimer) clearTimeout(browseSearchTimer);
	browseSearchTimer = setTimeout(() => {
		browseState.search = browseSearch.value.trim();
		browseState.offset = 0;
		browseState.view = "grid";
		renderBrowseViewState();
		void loadBrowsePacks();
	}, 300);
});

// Sort change
browseSortSelect.addEventListener("change", () => {
	browseState.sort = browseSortSelect.value as "newest" | "stars" | "installs";
	browseState.offset = 0;
	browseState.view = "grid";
	renderBrowseViewState();
	void loadBrowsePacks();
});

// Pagination
browsePrev.addEventListener("click", () => {
	browseState.offset = Math.max(0, browseState.offset - browseState.limit);
	browseState.view = "grid";
	void loadBrowsePacks();
	// Scroll content to top
	const content = document.getElementById("browseContent");
	if (content) content.scrollTop = 0;
});
browseNext.addEventListener("click", () => {
	browseState.offset += browseState.limit;
	browseState.view = "grid";
	void loadBrowsePacks();
	const content = document.getElementById("browseContent");
	if (content) content.scrollTop = 0;
});

// ---------- Initial state ----------

(async () => {
	let collapsed = false;
	let initialStatus: CaptureStatus = "idle";
	try {
		const state = await electrobun.rpc?.request?.getInitialState({});
		collapsed = !!state?.collapsed;
		initialStatus = state?.audioStatus ?? "idle";
		if (state?.audioSource) {
			currentAudioSource = state.audioSource;
			if (audioSourceSelect) audioSourceSelect.value = state.audioSource;
		}
		if (state?.registryUrl) registryUrl = state.registryUrl;
		if (state?.packs) populatePacks(state.packs, state.activePackId ?? null);
		if (state?.auto) applyAutoSettings(state.auto);
		if (state?.renderScale != null && renderScaleSelect) {
			// Find the closest matching option
			const scale = state.renderScale;
			const options = Array.from(renderScaleSelect.options);
			const closest = options.reduce((best, opt) =>
				Math.abs(Number(opt.value) - scale) < Math.abs(Number(best.value) - scale) ? opt : best,
			);
			renderScaleSelect.value = closest.value;
		}
	} catch (err) {
		console.warn("getInitialState failed; defaulting to expanded", err);
	}
	applyCollapsed(collapsed);
	updateStatus(initialStatus);
	document.documentElement.classList.remove("loading");
})();

// ---------- Smoothed meter ----------

let displayed = 0;
function tick() {
	displayed = displayed * 0.7 + lastLevel * 0.3;
	if (meterBar)
		meterBar.style.transform = `scaleX(${Math.min(1, displayed * 2)})`;
	requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

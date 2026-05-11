import Electrobun, { Electroview, type WgpuTagElement } from "electrobun/view";
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

// ---------- WGPU view initialization ----------

const wgpuTag = document.querySelector("electrobun-wgpu") as WgpuTagElement | null;
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
const packSearchRow = document.getElementById("packSearchRow") as HTMLElement | null;
const packSearch = document.getElementById("packSearch") as HTMLInputElement | null;
const importBtn = document.getElementById("importBtn") as HTMLButtonElement | null;
const nextBtn = document.getElementById("nextBtn") as HTMLButtonElement | null;
const autoChk = document.getElementById("autoChk") as HTMLInputElement | null;
const autoSec = document.getElementById("autoSec") as HTMLInputElement | null;
const shuffleChk = document.getElementById("shuffleChk") as HTMLInputElement | null;
const paramsPanel = document.getElementById("paramsPanel") as HTMLElement;
const audioSourceSelect = document.getElementById("audioSourceSelect") as HTMLSelectElement | null;
const permFixBtn = document.getElementById("permFixBtn") as HTMLButtonElement | null;
const errorBanner = document.getElementById("errorBanner") as HTMLElement | null;
const toastEl = document.getElementById("toast") as HTMLElement | null;
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
	if (autoChk) autoChk.checked = !!s.enabled;
	if (autoSec) autoSec.value = String(Math.max(5, s.seconds));
	if (shuffleChk) shuffleChk.checked = !!s.shuffle;
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
		favBtn.childNodes[favBtn.childNodes.length - 1]!.textContent =
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
			electrobun.rpc?.request?.exportPack({ id: packId }).then((r) => {
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
	return [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255];
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
			const v = Array.isArray(value) && value.length === 3 ? (value as number[]) : p.default;
			const input = document.createElement("input");
			input.type = "color";
			input.value = rgbToHex(v);
			input.className = "color-input";
			input.addEventListener("input", () => sendParam(packId, p.name, hexToRgb(input.value)));
			row.appendChild(input);
			break;
		}
		case "range": {
			const v = Array.isArray(value) && value.length === 2 ? (value as number[]) : p.default;
			const current = [v[0]!, v[1]!];
			const cell = document.createElement("span");
			cell.className = "param-multi";
			cell.appendChild(
				sliderInput(current[0]!, p.min, p.max, (p.max - p.min) / 200, (n) => {
					current[0] = n;
					sendParam(packId, p.name, [...current]);
				}),
			);
			cell.appendChild(
				sliderInput(current[1]!, p.min, p.max, (p.max - p.min) / 200, (n) => {
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
			const v = Array.isArray(value) && value.length === n ? (value as number[]) : (p.default as number[]);
			const current = v.slice();
			const cell = document.createElement("span");
			cell.className = "param-multi";
			for (let i = 0; i < n; i++) {
				cell.appendChild(
					sliderInput(current[i]!, -1, 1, 0.01, (val) => {
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
		if (state?.packs) populatePacks(state.packs, state.activePackId ?? null);
		if (state?.auto) applyAutoSettings(state.auto);
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
	if (meterBar) meterBar.style.width = `${Math.min(100, displayed * 200)}%`;
	requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

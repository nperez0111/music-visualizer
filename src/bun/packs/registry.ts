import { deletePref, getPref, listPrefKeys, setPref } from "../db";
import { findBuiltinPacksDir, loadAllPacks, type Pack } from "./loader";
import { instantiateWasmPack } from "./runtime";
import { removeUserPack } from "./import";
import { watchPacksDir } from "./dev-watch";
import {
	coerceParameterValue,
	defaultParameterValues,
	parameterFloatCount,
	type ParamValue,
	type ParamValueMap,
} from "./parameters";
import type { PackInfo } from "../../shared/rpc-types";

const PARAMS_KEY_PREFIX = "pack.params.";

function paramsKey(id: string) {
	return PARAMS_KEY_PREFIX + id;
}

/**
 * Owns the in-memory list of installed packs, their per-pack parameter
 * values, and the dev-mode hot-reload watcher. WASM modules are instantiated
 * lazily when packs first appear and carried over across reloads.
 *
 * Pack ids are content-addressed (sha256 of the pack record), so editing a
 * pack's shader during dev produces a new id; the registry matches packs by
 * directory path during hot-reload to keep the user's selection coherent.
 */
export class PackRegistry {
	private packs: Pack[] = [];
	private readonly paramValues = new Map<string, ParamValueMap>();
	private readonly listeners = new Set<() => void>();

	private constructor(
		private readonly userPacksDir: string,
	) {}

	static async create(userPacksDir: string): Promise<PackRegistry> {
		const reg = new PackRegistry(userPacksDir);
		reg.packs = loadAllPacks(userPacksDir);
		if (reg.packs.length === 0) {
			throw new Error("No visualizer packs found. Bundle should contain at least one pack.");
		}
		await reg.instantiateWasmFor(reg.packs);
		for (const p of reg.packs) reg.ensureParams(p);
		reg.cleanupOrphanParams();
		console.log(`[packs] loaded ${reg.packs.length} pack(s)`);
		return reg;
	}

	/** Subscribe to "the packs list / parameter values changed" events. */
	onChange(fn: () => void): void {
		this.listeners.add(fn);
	}

	private notify(): void {
		for (const fn of this.listeners) {
			try { fn(); } catch (err) { console.error("[packs] listener error:", err); }
		}
	}

	list(): Pack[] {
		return this.packs;
	}

	byId(id: string): Pack | undefined {
		return this.packs.find((p) => p.id === id);
	}

	/** Resolve a pack by manifest name (used to recover an active selection
	 *  across dev edits that change the content hash). Case-sensitive. */
	bySlug(name: string): Pack | undefined {
		return this.packs.find((p) => p.name === name);
	}

	getParamValues(p: Pack): ParamValueMap {
		return this.ensureParams(p);
	}

	setParameter(packId: string, name: string, value: ParamValue): boolean {
		const target = this.byId(packId);
		if (!target) return false;
		const param = target.parameters.find((pp) => pp.name === name);
		if (!param) return false;
		const coerced = coerceParameterValue(param, value);
		if (coerced === null) return false;
		const map = this.ensureParams(target);
		map[name] = coerced;
		setPref(paramsKey(target.id), map);
		return true;
	}

	applyPreset(packId: string, presetName: string): boolean {
		const target = this.byId(packId);
		if (!target) return false;
		const preset = target.presets.find((pr) => pr.name === presetName);
		if (!preset) return false;
		const map = this.ensureParams(target);
		for (const param of target.parameters) {
			const presetVal = preset.values[param.name];
			if (presetVal === undefined) continue;
			const coerced = coerceParameterValue(param, presetVal);
			if (coerced !== null) map[param.name] = coerced;
		}
		setPref(paramsKey(target.id), map);
		this.notify();
		return true;
	}

	packInfo(p: Pack): PackInfo {
		return {
			id: p.id,
			name: p.name,
			version: p.version,
			author: p.author,
			description: p.description,
			source: p.source,
			parameters: p.parameters,
			parameterValues: this.ensureParams(p),
			presets: p.presets,
			runtimeBroken: p.wasmRuntime?.isBroken() ?? false,
		};
	}

	allPackInfos(): PackInfo[] {
		return this.packs.map((p) => this.packInfo(p));
	}

	/**
	 * Re-scan packs from disk. Carries over already-instantiated WASM
	 * runtimes so reloads don't pay the recompile cost. Returns the new
	 * pack list.
	 */
	async reload(): Promise<Pack[]> {
		const fresh = loadAllPacks(this.userPacksDir);
		await this.instantiateWasmFor(fresh);
		const oldByPath = new Map(this.packs.map((p) => [p.path, p]));
		for (const p of fresh) {
			const prev = oldByPath.get(p.path);
			if (!p.wasmRuntime && prev?.wasmRuntime) p.wasmRuntime = prev.wasmRuntime;
		}
		// Free param-value maps for ids no longer present.
		const liveIds = new Set(fresh.map((p) => p.id));
		for (const id of Array.from(this.paramValues.keys())) {
			if (!liveIds.has(id)) this.paramValues.delete(id);
		}
		this.packs = fresh;
		for (const p of fresh) this.ensureParams(p);
		this.notify();
		return fresh;
	}

	removeUser(id: string): { ok: boolean; reason?: string } {
		const target = this.byId(id);
		if (!target) return { ok: false, reason: "unknown pack" };
		if (target.source !== "user") return { ok: false, reason: "not a user pack" };
		removeUserPack(this.userPacksDir, id);
		// Also drop the persisted params for this pack.
		try { deletePref(paramsKey(id)); } catch {}
		return { ok: true };
	}

	/**
	 * Wire up dev-mode hot-reload. The provided callback fires for each pack
	 * that changed (with WASM-changed flag and the prior pack id, when known)
	 * so the engine can drop pipelines and re-run WASM init as needed. The
	 * `prevId` lets callers fix up stale active-pack pointers when the hash
	 * rolls.
	 */
	watchForDevReload(opts: {
		onPackUpdated: (
			fresh: Pack,
			meta: { wasmChanged: boolean; prevId: string | null },
		) => void | Promise<void>;
	}): () => void {
		const builtinsDir = findBuiltinPacksDir();
		const isDevSource = !!builtinsDir && /(?:^|[\\/])src[\\/]packs$/.test(builtinsDir);
		if (!isDevSource || !builtinsDir) return () => {};
		console.log(`[packs] hot-reload watching ${builtinsDir}`);
		return watchPacksDir({
			packsDir: builtinsDir,
			onPackChanged: async ({ dirName, touched, fresh }) => {
				if (!fresh) {
					console.warn(`[packs] hot-reload: ${dirName} failed to revalidate; keeping previous version`);
					return;
				}
				// Match by directory path: the pack id rolls on every content
				// change, but the folder doesn't.
				const idx = this.packs.findIndex((p) => p.path === fresh.path);
				if (idx < 0) {
					console.log(`[packs] hot-reload: new pack folder "${dirName}", reloading list`);
					await this.reload();
					return;
				}
				const old = this.packs[idx]!;
				const wasmChanged = touched.has("pack.wasm");
				if (!wasmChanged && old.wasmRuntime) {
					fresh.wasmRuntime = old.wasmRuntime;
				}
				this.packs[idx] = fresh;
				if (old.id !== fresh.id) this.paramValues.delete(old.id);
				this.ensureParams(fresh);

				if (wasmChanged && fresh.wasmBytes) {
					old.wasmRuntime?.dispose?.();
					fresh.wasmRuntime = undefined;
					await this.instantiateWasmFor([fresh]);
				}

				console.log(`[packs] hot-reloaded "${dirName}" (${Array.from(touched).join(", ")})`);
				await opts.onPackUpdated(fresh, { wasmChanged, prevId: old.id });
				this.notify();
			},
		});
	}

	private ensureParams(p: Pack): ParamValueMap {
		let m = this.paramValues.get(p.id);
		if (!m) {
			m = this.loadOrInitParams(p);
			this.paramValues.set(p.id, m);
		}
		return m;
	}

	private loadOrInitParams(p: Pack): ParamValueMap {
		const defaults = defaultParameterValues(p.parameters);
		const saved = getPref<ParamValueMap | null>(paramsKey(p.id), null);
		if (saved && typeof saved === "object") {
			for (const param of p.parameters) {
				const v = saved[param.name];
				if (v === undefined) continue;
				const c = coerceParameterValue(param, v);
				if (c !== null) defaults[param.name] = c;
			}
		}
		return defaults;
	}

	private cleanupOrphanParams(): void {
		const live = new Set(this.packs.map((p) => paramsKey(p.id)));
		try {
			const keys = listPrefKeys(PARAMS_KEY_PREFIX);
			for (const k of keys) {
				if (!live.has(k)) {
					deletePref(k);
				}
			}
		} catch (err) {
			console.warn("[packs] orphan-params cleanup failed:", err);
		}
	}

	private async instantiateWasmFor(list: Pack[]): Promise<void> {
		for (const p of list) {
			if (!p.wasmBytes || p.wasmRuntime) continue;
			try {
				p.wasmRuntime = await instantiateWasmPack({
					packId: p.id,
					bytes: p.wasmBytes,
					parameterCount: parameterFloatCount(p.parameters),
				});
				console.log(
					`[packs] WASM ready for "${p.name}" (uniform size ${p.wasmRuntime.packUniformSize})`,
				);
			} catch (err) {
				console.error(`[packs] WASM init failed for "${p.name}":`, err);
			}
		}
	}
}

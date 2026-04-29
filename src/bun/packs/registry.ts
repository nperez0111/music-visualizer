import { getPref, setPref } from "../db";
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

function paramsKey(id: string) {
	return `pack.params.${id}`;
}

/**
 * Owns the in-memory list of installed packs, their per-pack parameter
 * values, and the dev-mode hot-reload watcher. WASM modules are instantiated
 * lazily when packs first appear and carried over across reloads.
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
		console.log(`[packs] loaded ${reg.packs.length} pack(s): ${reg.packs.map((p) => p.id).join(", ")}`);
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
		const oldById = new Map(this.packs.map((p) => [p.id, p]));
		for (const p of fresh) {
			if (!p.wasmRuntime && oldById.get(p.id)?.wasmRuntime) {
				p.wasmRuntime = oldById.get(p.id)!.wasmRuntime;
			}
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
		return { ok: true };
	}

	/**
	 * Wire up dev-mode hot-reload. The provided callback fires for each pack
	 * that changed (with WASM-changed flag) so the engine can drop pipelines
	 * and re-run WASM init as needed.
	 */
	watchForDevReload(opts: {
		onPackUpdated: (
			fresh: Pack,
			meta: { wasmChanged: boolean },
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
				const idx = this.packs.findIndex((p) => p.id === fresh.id);
				if (idx < 0) {
					// New pack appeared; full reload picks it up and notifies UI.
					console.log(`[packs] hot-reload: new pack "${fresh.id}", reloading list`);
					await this.reload();
					return;
				}
				const old = this.packs[idx]!;
				const wasmChanged = touched.has("pack.wasm");
				if (!wasmChanged && old.wasmRuntime) {
					fresh.wasmRuntime = old.wasmRuntime;
				}
				this.packs[idx] = fresh;
				this.ensureParams(fresh);

				if (wasmChanged && fresh.wasmBytes) {
					fresh.wasmRuntime = undefined;
					await this.instantiateWasmFor([fresh]);
				}

				console.log(`[packs] hot-reloaded "${fresh.id}" (${Array.from(touched).join(", ")})`);
				await opts.onPackUpdated(fresh, { wasmChanged });
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
					`[packs] WASM ready for "${p.id}" (uniform size ${p.wasmRuntime.packUniformSize})`,
				);
			} catch (err) {
				console.error(`[packs] WASM init failed for "${p.id}":`, err);
			}
		}
	}
}

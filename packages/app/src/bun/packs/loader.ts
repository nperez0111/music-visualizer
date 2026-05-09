import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { findBuiltinPacksDir } from "../paths";
import { computePackHashFromDir } from "./hash";
import { transpileGlslToWgsl } from "./glsl-transpile";

export type {
	PackParameter,
	PackPreset,
	ParamValue,
	ParamValueMap,
	PackManifest,
	PackManifestImage,
	PackAudioFeatureName,
} from "@catnip/shared";
export { validateManifest } from "@catnip/shared";
export { findBuiltinPacksDir };

import { validateManifest } from "@catnip/shared";
import type { PackManifest, PackParameter, PackPreset } from "@catnip/shared";

import type { WasmRuntime } from "./runtime";

export type Pack = {
	/** Content-addressed pack id: lowercase hex SHA-256 of the canonical pack record. */
	id: string;
	name: string;
	version: string;
	author?: string;
	description?: string;
	manifest: PackManifest;
	parameters: PackParameter[];
	presets: PackPreset[];
	shaderText: string;
	/**
	 * Loaded post-FX shader sources, in declared order. Empty for single-pass packs.
	 * Each pass shader samples the previous pass's color via @group(3).
	 */
	extraPasses: Array<{ shaderText: string }>;
	/** True if the main shader binds @group(2) — host wires prev-frame texture/sampler. */
	usesPrevFrame: boolean;
	wasmBytes?: Uint8Array;
	wasmRuntime?: WasmRuntime;
	path: string;
	source: "builtin" | "user";
};

const PREV_FRAME_GROUP_RE = /@group\s*\(\s*2\s*\)/;

/**
 * Synchronously load all valid packs found under `dir`. Each pack is one
 * subdirectory containing `manifest.json` and the WGSL file the manifest
 * references. Bad packs are logged and skipped, never thrown.
 *
 * Pack id is computed from the canonical hash of the directory contents,
 * not from any field in the manifest.
 */
export function loadPacksFromDir(dir: string, source: "builtin" | "user"): Pack[] {
	if (!existsSync(dir)) return [];
	const out: Pack[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const packDir = join(dir, entry.name);
		const manifestPath = join(packDir, "manifest.json");
		if (!existsSync(manifestPath)) continue;
		try {
			const raw = JSON.parse(readFileSync(manifestPath, "utf8"));
			const v = validateManifest(raw);
			if (!v.ok) {
				console.warn(`[packs] skipping ${entry.name}: ${v.err}`);
				continue;
			}
			const shaderPath = join(packDir, v.m.shader);
			if (!existsSync(shaderPath)) {
				console.warn(`[packs] skipping ${entry.name}: shader file missing (${v.m.shader})`);
				continue;
			}
			let shaderText = readFileSync(shaderPath, "utf8");
			if (shaderPath.endsWith(".glsl")) {
				const tr = transpileGlslToWgsl(shaderText, {
					parameters: v.m.parameters,
				});
				if (!tr.ok) {
					console.warn(`[packs] skipping ${entry.name}: GLSL transpilation failed (${tr.stage}): ${tr.error}`);
					continue;
				}
				shaderText = tr.wgsl;
			}
			const extraPasses: Array<{ shaderText: string }> = [];
			let extraPassFailed = false;
			for (const pass of v.m.passes ?? []) {
				const pPath = join(packDir, pass.shader);
				if (!existsSync(pPath)) {
					console.warn(`[packs] skipping ${entry.name}: pass shader missing (${pass.shader})`);
					extraPassFailed = true;
					break;
				}
				let passText = readFileSync(pPath, "utf8");
				if (pPath.endsWith(".glsl")) {
					const tr = transpileGlslToWgsl(passText, {
						parameters: v.m.parameters,
						interPass: true,
					});
					if (!tr.ok) {
						console.warn(`[packs] skipping ${entry.name}: GLSL transpilation failed for pass ${pass.shader} (${tr.stage}): ${tr.error}`);
						extraPassFailed = true;
						break;
					}
					passText = tr.wgsl;
				}
				extraPasses.push({ shaderText: passText });
			}
			if (extraPassFailed) continue;
			let wasmBytes: Uint8Array | undefined;
			if (v.m.wasm) {
				const wasmPath = join(packDir, v.m.wasm);
				if (existsSync(wasmPath)) {
					wasmBytes = new Uint8Array(readFileSync(wasmPath));
				} else {
					console.warn(`[packs] ${entry.name}: declared wasm "${v.m.wasm}" not found; falling back to Tier 1`);
				}
			}
			const id = computePackHashFromDir(packDir);
			out.push({
				id,
				name: v.m.name,
				version: v.m.version,
				author: v.m.author,
				description: v.m.description,
				manifest: v.m,
				parameters: v.m.parameters ?? [],
				presets: v.m.presets ?? [],
				shaderText,
				extraPasses,
				usesPrevFrame: PREV_FRAME_GROUP_RE.test(shaderText),
				wasmBytes,
				path: packDir,
				source,
			});
		} catch (err) {
			console.warn(`[packs] error reading ${entry.name}:`, err);
		}
	}
	return out;
}

export function loadAllPacks(userPacksDir?: string): Pack[] {
	const builtinsDir = findBuiltinPacksDir();
	const builtins = builtinsDir ? loadPacksFromDir(builtinsDir, "builtin") : [];
	const userPacks = userPacksDir ? loadPacksFromDir(userPacksDir, "user") : [];
	// Built-ins win on hash collision (impossible in practice with sha256 but
	// formalize the precedence so an attacker can't sneak in a duplicate).
	const byId = new Map<string, Pack>();
	for (const p of userPacks) byId.set(p.id, p);
	for (const p of builtins) byId.set(p.id, p);
	return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

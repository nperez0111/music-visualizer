import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import type {
	PackParameter,
	PackPreset,
	ParamValue,
	ParamValueMap,
} from "../../shared/rpc-types";
import { findBuiltinPacksDir } from "../paths";
import { computePackHashFromDir } from "./hash";

export type { PackParameter, PackPreset, ParamValue, ParamValueMap };
export { findBuiltinPacksDir };

export type PackManifestImage = { name: string; file: string };
export type PackAudioFeatureName =
	| "rms"
	| "peak"
	| "bass"
	| "mid"
	| "treble"
	| "bpm"
	| "beat_phase";

export type PackManifest = {
	schemaVersion: number;
	name: string;
	version: string;
	author?: string;
	description?: string;
	shader: string;
	wasm?: string;
	audio?: { features?: PackAudioFeatureName[] };
	parameters?: PackParameter[];
	images?: PackManifestImage[];
	presets?: PackPreset[];
	/** Human-readable discovery tags for gallery search (e.g. "fractal", "retro", "3d"). */
	tags?: string[];
	/**
	 * Optional post-FX chain. Each entry's shader runs after the main pass,
	 * sampling the previous pass's color via @group(3). Last pass output is
	 * what the host treats as the pack's final image.
	 */
	passes?: Array<{ shader: string }>;
};

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

const KNOWN_AUDIO_FEATURES: ReadonlySet<PackAudioFeatureName> = new Set([
	"rms",
	"peak",
	"bass",
	"mid",
	"treble",
	"bpm",
	"beat_phase",
]);

function validateParameter(raw: unknown): PackParameter | null {
	if (typeof raw !== "object" || raw === null) return null;
	const p = raw as Record<string, unknown>;
	if (typeof p.name !== "string" || !/^[a-z][a-z0-9_]{0,31}$/i.test(p.name)) return null;
	const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
	const arr = (v: unknown, n: number) =>
		Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number") ? (v as number[]) : null;
	switch (p.type) {
		case "float":
		case "int": {
			const min = num(p.min);
			const max = num(p.max);
			const def = num(p.default);
			if (min === null || max === null || def === null || min > max) return null;
			return { type: p.type, name: p.name, label: p.label as string | undefined, min, max, default: def };
		}
		case "bool":
			if (typeof p.default !== "boolean") return null;
			return { type: "bool", name: p.name, label: p.label as string | undefined, default: p.default };
		case "enum": {
			if (!Array.isArray(p.options) || p.options.length === 0) return null;
			const opts = p.options.filter((o) => typeof o === "string") as string[];
			if (opts.length !== p.options.length) return null;
			if (typeof p.default !== "string" || !opts.includes(p.default)) return null;
			return { type: "enum", name: p.name, label: p.label as string | undefined, options: opts, default: p.default };
		}
		case "color": {
			const def = arr(p.default, 3);
			if (!def) return null;
			return { type: "color", name: p.name, label: p.label as string | undefined, default: def as [number, number, number] };
		}
		case "range": {
			const min = num(p.min);
			const max = num(p.max);
			const def = arr(p.default, 2);
			if (min === null || max === null || !def || min > max) return null;
			return { type: "range", name: p.name, label: p.label as string | undefined, min, max, default: def as [number, number] };
		}
		case "vec2":
		case "vec3":
		case "vec4": {
			const n = p.type === "vec2" ? 2 : p.type === "vec3" ? 3 : 4;
			const def = arr(p.default, n);
			if (!def) return null;
			return { type: p.type, name: p.name, label: p.label as string | undefined, default: def as any };
		}
	}
	return null;
}

function validateImages(raw: unknown): PackManifestImage[] | "invalid" {
	if (!Array.isArray(raw)) return "invalid";
	const out: PackManifestImage[] = [];
	const seen = new Set<string>();
	for (const item of raw) {
		if (!item || typeof item !== "object") return "invalid";
		const r = item as Record<string, unknown>;
		if (typeof r.name !== "string" || !r.name) return "invalid";
		if (typeof r.file !== "string" || !r.file) return "invalid";
		// Reject path traversal in declared image filenames.
		if (r.file.includes("..") || r.file.includes("\\") || r.file.includes("\0") || r.file.startsWith("/")) {
			return "invalid";
		}
		if (seen.has(r.name)) return "invalid";
		seen.add(r.name);
		out.push({ name: r.name, file: r.file });
	}
	return out;
}

function validateAudio(raw: unknown): { features?: PackAudioFeatureName[] } | "invalid" {
	if (!raw || typeof raw !== "object") return "invalid";
	const r = raw as Record<string, unknown>;
	const out: { features?: PackAudioFeatureName[] } = {};
	if (r.features !== undefined) {
		if (!Array.isArray(r.features)) return "invalid";
		const feats: PackAudioFeatureName[] = [];
		const seen = new Set<string>();
		for (const f of r.features) {
			if (typeof f !== "string" || !KNOWN_AUDIO_FEATURES.has(f as PackAudioFeatureName)) return "invalid";
			if (seen.has(f)) continue;
			seen.add(f);
			feats.push(f as PackAudioFeatureName);
		}
		out.features = feats;
	}
	return out;
}

export function validateManifest(raw: unknown): { ok: true; m: PackManifest } | { ok: false; err: string } {
	if (typeof raw !== "object" || raw === null) return { ok: false, err: "not an object" };
	const m = raw as Record<string, unknown>;
	if (m.schemaVersion !== 1) return { ok: false, err: `schemaVersion must be 1 (got ${m.schemaVersion})` };
	if (typeof m.name !== "string" || !m.name) return { ok: false, err: "name required" };
	if (typeof m.version !== "string" || !m.version) return { ok: false, err: "version required" };
	if (typeof m.shader !== "string" || !(m.shader as string).endsWith(".wgsl"))
		return { ok: false, err: "shader must point to a .wgsl file" };
	if (m.wasm !== undefined && (typeof m.wasm !== "string" || !(m.wasm as string).endsWith(".wasm")))
		return { ok: false, err: "wasm must point to a .wasm file" };
	if (m.author !== undefined && typeof m.author !== "string")
		return { ok: false, err: "author must be a string" };
	if (m.description !== undefined && typeof m.description !== "string")
		return { ok: false, err: "description must be a string" };

	const out: PackManifest = {
		schemaVersion: 1,
		name: m.name as string,
		version: m.version as string,
		shader: m.shader as string,
	};
	if (typeof m.author === "string") out.author = m.author;
	if (typeof m.description === "string") out.description = m.description;
	if (typeof m.wasm === "string") out.wasm = m.wasm;

	if (m.audio !== undefined) {
		const a = validateAudio(m.audio);
		if (a === "invalid") return { ok: false, err: "audio block invalid" };
		out.audio = a;
	}
	if (m.images !== undefined) {
		const im = validateImages(m.images);
		if (im === "invalid") return { ok: false, err: "images must be Array<{name, file}>" };
		out.images = im;
	}
	if (m.parameters !== undefined) {
		if (!Array.isArray(m.parameters)) return { ok: false, err: "parameters must be an array" };
		const validated: PackParameter[] = [];
		const seen = new Set<string>();
		for (let i = 0; i < m.parameters.length; i++) {
			const p = validateParameter(m.parameters[i]);
			if (!p) return { ok: false, err: `parameters[${i}] invalid` };
			if (seen.has(p.name)) return { ok: false, err: `parameters[${i}] duplicate name "${p.name}"` };
			seen.add(p.name);
			validated.push(p);
		}
		out.parameters = validated;
	}
	if (m.tags !== undefined) {
		if (!Array.isArray(m.tags) || !m.tags.every((t: unknown) => typeof t === "string"))
			return { ok: false, err: "tags must be an array of strings" };
		out.tags = m.tags as string[];
	}
	if (m.passes !== undefined) {
		if (!Array.isArray(m.passes)) return { ok: false, err: "passes must be an array" };
		const validatedPasses: Array<{ shader: string }> = [];
		for (let i = 0; i < m.passes.length; i++) {
			const raw = m.passes[i] as Record<string, unknown> | null;
			if (!raw || typeof raw !== "object")
				return { ok: false, err: `passes[${i}] not an object` };
			if (typeof raw.shader !== "string" || !raw.shader.endsWith(".wgsl"))
				return { ok: false, err: `passes[${i}].shader must point to a .wgsl file` };
			validatedPasses.push({ shader: raw.shader });
		}
		out.passes = validatedPasses;
	}
	if (m.presets !== undefined) {
		if (!Array.isArray(m.presets)) return { ok: false, err: "presets must be an array" };
		const paramNames = new Set((out.parameters ?? []).map((p) => p.name));
		const validatedPresets: PackPreset[] = [];
		const seenNames = new Set<string>();
		for (let i = 0; i < m.presets.length; i++) {
			const raw = m.presets[i] as Record<string, unknown> | null;
			if (!raw || typeof raw !== "object") return { ok: false, err: `presets[${i}] not an object` };
			if (typeof raw.name !== "string" || !raw.name)
				return { ok: false, err: `presets[${i}] missing name` };
			if (seenNames.has(raw.name))
				return { ok: false, err: `presets[${i}] duplicate name "${raw.name}"` };
			seenNames.add(raw.name);
			const values = raw.values;
			if (typeof values !== "object" || values === null || Array.isArray(values))
				return { ok: false, err: `presets[${i}] values must be an object` };
			// Drop unknown keys so an outdated preset doesn't shove garbage at the
			// pack — values for missing parameters fall back to defaults at apply.
			const cleaned: ParamValueMap = {};
			for (const [k, v] of Object.entries(values)) {
				if (!paramNames.has(k)) continue;
				cleaned[k] = v as ParamValue;
			}
			validatedPresets.push({ name: raw.name, values: cleaned });
		}
		out.presets = validatedPresets;
	}
	return { ok: true, m: out };
}

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
			const shaderText = readFileSync(shaderPath, "utf8");
			const extraPasses: Array<{ shaderText: string }> = [];
			let extraPassFailed = false;
			for (const pass of v.m.passes ?? []) {
				const pPath = join(packDir, pass.shader);
				if (!existsSync(pPath)) {
					console.warn(`[packs] skipping ${entry.name}: pass shader missing (${pass.shader})`);
					extraPassFailed = true;
					break;
				}
				extraPasses.push({ shaderText: readFileSync(pPath, "utf8") });
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

// Pack manifest validation using valibot for schema-based safety.
// Portable — no filesystem or bun-specific deps.

import * as v from "valibot";
import type {
	PackAudioFeatureName,
	PackManifest,
	PackManifestImage,
	PackParameter,
	PackPreset,
	ParamValue,
	ParamValueMap,
} from "./types";

// ─── Security helpers ─────────────────────────────────────────────────────���

/**
 * Security: Reject file paths that could escape the pack directory.
 * Checks for path traversal sequences, backslashes, null bytes, and absolute paths.
 */
function isUnsafeFilePath(p: string): boolean {
	if (!p) return true;
	if (p.startsWith("/")) return true;
	if (p.includes("..")) return true;
	if (p.includes("\\")) return true;
	if (p.includes("\0")) return true;
	return false;
}

/** Valibot action: rejects unsafe file paths (path traversal). */
const safePath = v.check(
	(val: string) => !isUnsafeFilePath(val),
	"path contains unsafe characters (path traversal)",
);

// ─── Primitive schemas ─────────────────────────────────────────────────────

const finiteNumber = v.pipe(v.number(), v.finite());

const paramName = v.pipe(
	v.string(),
	v.regex(/^[a-z][a-z0-9_]{0,31}$/i, "must be 1-32 alphanumeric/underscore chars starting with a letter"),
);

const shaderPath = v.pipe(
	v.string(),
	v.check((s) => s.endsWith(".wgsl") || s.endsWith(".glsl"), "must end with .wgsl or .glsl"),
	safePath,
);

const wasmPath = v.pipe(
	v.string(),
	v.check((s) => s.endsWith(".wasm"), "must end with .wasm"),
	safePath,
);

// ─── Parameter schemas (discriminated union on `type`) ─────────────────────

const optionalLabel = v.optional(v.pipe(v.string(), v.maxLength(128)));

const FloatParam = v.pipe(
	v.object({
		type: v.literal("float"),
		name: paramName,
		label: optionalLabel,
		min: finiteNumber,
		max: finiteNumber,
		default: finiteNumber,
	}),
	v.check((p) => p.min <= p.max, "min must be <= max"),
);

const IntParam = v.pipe(
	v.object({
		type: v.literal("int"),
		name: paramName,
		label: optionalLabel,
		min: finiteNumber,
		max: finiteNumber,
		default: finiteNumber,
	}),
	v.check((p) => p.min <= p.max, "min must be <= max"),
);

const BoolParam = v.object({
	type: v.literal("bool"),
	name: paramName,
	label: optionalLabel,
	default: v.boolean(),
});

const EnumParam = v.pipe(
	v.object({
		type: v.literal("enum"),
		name: paramName,
		label: optionalLabel,
		options: v.pipe(v.array(v.string()), v.minLength(1)),
		default: v.string(),
	}),
	v.check((p) => p.options.includes(p.default), "default must be one of options"),
);

const ColorParam = v.object({
	type: v.literal("color"),
	name: paramName,
	label: optionalLabel,
	default: v.pipe(v.array(finiteNumber), v.length(3)) as any,
});

const RangeParam = v.pipe(
	v.object({
		type: v.literal("range"),
		name: paramName,
		label: optionalLabel,
		min: finiteNumber,
		max: finiteNumber,
		default: v.pipe(v.array(finiteNumber), v.length(2)) as any,
	}),
	v.check((p) => p.min <= p.max, "min must be <= max"),
);

const Vec2Param = v.object({
	type: v.literal("vec2"),
	name: paramName,
	label: optionalLabel,
	default: v.pipe(v.array(finiteNumber), v.length(2)) as any,
});

const Vec3Param = v.object({
	type: v.literal("vec3"),
	name: paramName,
	label: optionalLabel,
	default: v.pipe(v.array(finiteNumber), v.length(3)) as any,
});

const Vec4Param = v.object({
	type: v.literal("vec4"),
	name: paramName,
	label: optionalLabel,
	default: v.pipe(v.array(finiteNumber), v.length(4)) as any,
});

const ParameterSchema = v.variant("type", [
	FloatParam,
	IntParam,
	BoolParam,
	EnumParam,
	ColorParam,
	RangeParam,
	Vec2Param,
	Vec3Param,
	Vec4Param,
]);

// ─── Sub-schemas ───────────────────────────────────────────────────────────

const KNOWN_AUDIO_FEATURES = ["rms", "peak", "bass", "mid", "treble", "bpm", "beat_phase"] as const;

const AudioSchema = v.object({
	features: v.optional(
		v.pipe(
			v.array(v.picklist(KNOWN_AUDIO_FEATURES)),
			v.maxLength(KNOWN_AUDIO_FEATURES.length),
		),
	),
});

const ImageSchema = v.pipe(
	v.object({
		name: v.pipe(v.string(), v.nonEmpty(), v.maxLength(64)),
		file: v.pipe(v.string(), v.nonEmpty(), v.maxLength(256), safePath),
	}),
);

const PassSchema = v.object({
	shader: shaderPath,
});

const ParamValueSchema: v.GenericSchema<ParamValue> = v.union([
	v.number(),
	v.boolean(),
	v.string(),
	v.array(v.number()),
]) as any;

/** Validates that `values` is a plain object (not array/null) mapping param names to values. */
const PresetValuesSchema = v.pipe(
	v.custom<Record<string, ParamValue>>(
		(val) => typeof val === "object" && val !== null && !Array.isArray(val),
		"values must be a plain object",
	),
	v.record(v.string(), ParamValueSchema),
);

const PresetSchema = v.object({
	name: v.pipe(v.string(), v.nonEmpty(), v.maxLength(128)),
	values: PresetValuesSchema,
});

const TagSchema = v.pipe(v.string(), v.nonEmpty(), v.maxLength(64));

// ─── Top-level manifest schema ─────────────────────────────────────────────

const ManifestSchema = v.object({
	schemaVersion: v.literal(1),
	name: v.pipe(v.string(), v.nonEmpty(), v.maxLength(128)),
	version: v.pipe(
		v.string(),
		v.nonEmpty(),
		v.maxLength(64),
		v.check((s) => !/[/\\:*?"<>|]/.test(s), "contains invalid characters"),
	),
	shader: shaderPath,
	wasm: v.optional(wasmPath),
	author: v.optional(v.pipe(v.string(), v.maxLength(128))),
	description: v.optional(v.pipe(v.string(), v.maxLength(1024))),
	audio: v.optional(AudioSchema),
	images: v.optional(v.pipe(v.array(ImageSchema), v.maxLength(32))),
	parameters: v.optional(v.pipe(v.array(ParameterSchema), v.maxLength(64))),
	tags: v.optional(v.pipe(v.array(TagSchema), v.maxLength(10))),
	passes: v.optional(v.pipe(v.array(PassSchema), v.maxLength(16))),
	presets: v.optional(v.pipe(v.array(PresetSchema), v.maxLength(32))),
});

// ─── Public API (backward-compatible) ──────────────────────────────────────

/**
 * Validate a raw JSON-parsed manifest. Returns a typed result with either
 * the validated manifest or a human-readable error string.
 *
 * Security invariants enforced:
 * - All file paths (shader, wasm, passes, images) reject path traversal
 * - String fields have length limits to prevent memory exhaustion
 * - Parameter names are restricted to safe identifiers (no injection)
 */
export function validateManifest(raw: unknown): { ok: true; m: PackManifest } | { ok: false; err: string } {
	const result = v.safeParse(ManifestSchema, raw);
	if (!result.success) {
		const issue = result.issues[0];
		// Format path like "parameters[0].name" for backward-compatible errors
		const path = issue.path
			?.map((seg: { key?: string | number }, i: number) => {
				const key = "key" in seg ? seg.key : String(seg);
				if (typeof key === "number" || /^\d+$/.test(String(key))) {
					return `[${key}]`;
				}
				return i === 0 ? key : `.${key}`;
			})
			.join("") ?? "";
		const prefix = path ? `${path}: ` : "";
		return { ok: false, err: `${prefix}${issue.message}` };
	}

	const m = result.output;

	// Additional cross-field validations that valibot can't express declaratively:

	// 1. Deduplicate parameter names
	if (m.parameters) {
		const seen = new Set<string>();
		for (let i = 0; i < m.parameters.length; i++) {
			const name = m.parameters[i].name;
			if (seen.has(name)) return { ok: false, err: `parameters[${i}] duplicate name "${name}"` };
			seen.add(name);
		}
	}

	// 2. Deduplicate image names
	if (m.images) {
		const seen = new Set<string>();
		for (let i = 0; i < m.images.length; i++) {
			const name = m.images[i].name;
			if (seen.has(name)) return { ok: false, err: `images[${i}] duplicate name "${name}"` };
			seen.add(name);
		}
	}

	// 3. Deduplicate preset names & filter preset values to known params
	if (m.presets) {
		const paramNames = new Set((m.parameters ?? []).map((p) => p.name));
		const seenNames = new Set<string>();
		const cleanedPresets: PackPreset[] = [];
		for (let i = 0; i < m.presets.length; i++) {
			const preset = m.presets[i];
			if (seenNames.has(preset.name))
				return { ok: false, err: `presets[${i}] duplicate name "${preset.name}"` };
			seenNames.add(preset.name);
			const cleaned: ParamValueMap = {};
			for (const [k, val] of Object.entries(preset.values)) {
				if (paramNames.has(k)) cleaned[k] = val;
			}
			cleanedPresets.push({ name: preset.name, values: cleaned });
		}
		// Replace presets with cleaned version
		(m as any).presets = cleanedPresets;
	}

	// 4. Deduplicate audio features
	if (m.audio?.features) {
		const unique = [...new Set(m.audio.features)];
		(m.audio as any).features = unique;
	}

	return { ok: true, m: m as PackManifest };
}

/** Re-export for use in import.ts and other path-checking contexts. */
export { isUnsafeFilePath };

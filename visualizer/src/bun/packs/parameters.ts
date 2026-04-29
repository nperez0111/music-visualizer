import type { PackParameter, ParamValue, ParamValueMap } from "./loader";

export type { ParamValue, ParamValueMap };

/**
 * Each parameter occupies one 16-byte (vec4) slot in the per-pack parameter
 * uniform buffer; scalars sit in `.x`, vec3 in `.xyz`, etc. v1 keeps the
 * layout positional (manifest order) and over-aligned for simplicity.
 */
export const PARAM_SLOT_BYTES = 16;
export const PARAM_FLOATS_PER_SLOT = 4;

/**
 * Min size for the buffer in bytes. wgpu requires a non-zero uniform buffer,
 * so packs with no parameters still get one slot of padding.
 */
export function parameterBufferSize(parameters: PackParameter[]): number {
	return Math.max(PARAM_SLOT_BYTES, parameters.length * PARAM_SLOT_BYTES);
}

/** Number of f32s in the WASM-side scratch region (`params_ptr`). */
export function parameterFloatCount(parameters: PackParameter[]): number {
	return parameters.length * PARAM_FLOATS_PER_SLOT;
}

/** Build a fresh value map from manifest defaults. */
export function defaultParameterValues(parameters: PackParameter[]): ParamValueMap {
	const out: ParamValueMap = {};
	for (const p of parameters) {
		out[p.name] = Array.isArray(p.default) ? p.default.slice() : p.default;
	}
	return out;
}

/** Pack the current parameter values into a Float32Array (manifest order, vec4 slots). */
export function packParameterValues(
	parameters: PackParameter[],
	values: ParamValueMap,
	out: Float32Array,
): void {
	for (let i = 0; i < parameters.length; i++) {
		const p = parameters[i]!;
		const slot = i * PARAM_FLOATS_PER_SLOT;
		const v = values[p.name];
		switch (p.type) {
			case "float":
			case "int": {
				const n = typeof v === "number" ? v : p.default;
				out[slot] = n;
				out[slot + 1] = 0;
				out[slot + 2] = 0;
				out[slot + 3] = 0;
				break;
			}
			case "bool": {
				const b = typeof v === "boolean" ? v : p.default;
				out[slot] = b ? 1 : 0;
				out[slot + 1] = 0;
				out[slot + 2] = 0;
				out[slot + 3] = 0;
				break;
			}
			case "enum": {
				const s = typeof v === "string" && p.options.includes(v) ? v : p.default;
				out[slot] = p.options.indexOf(s);
				out[slot + 1] = 0;
				out[slot + 2] = 0;
				out[slot + 3] = 0;
				break;
			}
			case "color":
			case "vec3": {
				const a = Array.isArray(v) && v.length === 3 ? v : p.default;
				out[slot] = a[0] ?? 0;
				out[slot + 1] = a[1] ?? 0;
				out[slot + 2] = a[2] ?? 0;
				out[slot + 3] = 0;
				break;
			}
			case "range":
			case "vec2": {
				const a = Array.isArray(v) && v.length === 2 ? v : p.default;
				out[slot] = a[0] ?? 0;
				out[slot + 1] = a[1] ?? 0;
				out[slot + 2] = 0;
				out[slot + 3] = 0;
				break;
			}
			case "vec4": {
				const a = Array.isArray(v) && v.length === 4 ? v : p.default;
				out[slot] = a[0] ?? 0;
				out[slot + 1] = a[1] ?? 0;
				out[slot + 2] = a[2] ?? 0;
				out[slot + 3] = a[3] ?? 0;
				break;
			}
		}
	}
}

/**
 * Coerce a raw incoming value (from RPC) into the type the parameter expects,
 * clamping/snapping where applicable. Returns null if the value is unusable.
 */
export function coerceParameterValue(p: PackParameter, raw: unknown): ParamValue | null {
	switch (p.type) {
		case "float": {
			if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
			return Math.min(p.max, Math.max(p.min, raw));
		}
		case "int": {
			if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
			return Math.round(Math.min(p.max, Math.max(p.min, raw)));
		}
		case "bool":
			return typeof raw === "boolean" ? raw : null;
		case "enum":
			return typeof raw === "string" && p.options.includes(raw) ? raw : null;
		case "color":
			return Array.isArray(raw) && raw.length === 3 && raw.every((n) => typeof n === "number")
				? (raw.map((n) => Math.min(1, Math.max(0, n))) as number[])
				: null;
		case "range": {
			if (!Array.isArray(raw) || raw.length !== 2) return null;
			if (!raw.every((n) => typeof n === "number")) return null;
			const lo = Math.min(p.max, Math.max(p.min, raw[0]));
			const hi = Math.min(p.max, Math.max(p.min, raw[1]));
			return [Math.min(lo, hi), Math.max(lo, hi)];
		}
		case "vec2":
		case "vec3":
		case "vec4": {
			const n = p.type === "vec2" ? 2 : p.type === "vec3" ? 3 : 4;
			return Array.isArray(raw) && raw.length === n && raw.every((x) => typeof x === "number")
				? (raw as number[])
				: null;
		}
	}
}

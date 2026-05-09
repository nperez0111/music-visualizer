// Core pack types shared across desktop app, CLI, and server.

export type PackParameter =
	| { type: "float"; name: string; label?: string; min: number; max: number; default: number }
	| { type: "int"; name: string; label?: string; min: number; max: number; default: number }
	| { type: "bool"; name: string; label?: string; default: boolean }
	| { type: "enum"; name: string; label?: string; options: string[]; default: string }
	| { type: "color"; name: string; label?: string; default: [number, number, number] }
	| { type: "range"; name: string; label?: string; min: number; max: number; default: [number, number] }
	| { type: "vec2"; name: string; label?: string; default: [number, number] }
	| { type: "vec3"; name: string; label?: string; default: [number, number, number] }
	| { type: "vec4"; name: string; label?: string; default: [number, number, number, number] };

export type ParamValue = number | boolean | string | number[];
export type ParamValueMap = Record<string, ParamValue>;

export type PackPreset = { name: string; values: ParamValueMap };

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

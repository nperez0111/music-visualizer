import { describe, test, expect } from "bun:test";
import { validateManifest } from "./manifest";

const MINIMAL = {
	schemaVersion: 1,
	name: "Test",
	version: "1.0.0",
	shader: "shader.wgsl",
};

describe("validateManifest", () => {
	test("accepts minimal valid manifest", () => {
		const r = validateManifest(MINIMAL);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.m.name).toBe("Test");
			expect(r.m.version).toBe("1.0.0");
			expect(r.m.shader).toBe("shader.wgsl");
		}
	});

	test("accepts GLSL shader extension", () => {
		const r = validateManifest({ ...MINIMAL, shader: "shader.glsl" });
		expect(r.ok).toBe(true);
	});

	test("accepts full manifest with all optional fields", () => {
		const r = validateManifest({
			...MINIMAL,
			author: "alice",
			description: "a test pack",
			wasm: "pack.wasm",
			tags: ["glsl", "fractal"],
			audio: { features: ["bass", "mid", "treble"] },
			images: [{ name: "bg", file: "bg.png" }],
			parameters: [
				{ type: "float", name: "speed", min: 0, max: 4, default: 1 },
				{ type: "bool", name: "invert", default: false },
			],
			presets: [
				{ name: "Calm", values: { speed: 0.5 } },
			],
			passes: [{ shader: "bloom.wgsl" }],
		});
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.m.author).toBe("alice");
			expect(r.m.parameters!.length).toBe(2);
			expect(r.m.presets!.length).toBe(1);
			expect(r.m.passes!.length).toBe(1);
			expect(r.m.tags).toEqual(["glsl", "fractal"]);
		}
	});

	// ---- rejections ----

	test("rejects null", () => {
		const r = validateManifest(null);
		expect(r.ok).toBe(false);
	});

	test("rejects missing schemaVersion", () => {
		const r = validateManifest({ name: "X", version: "1", shader: "s.wgsl" });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.err).toMatch(/schemaVersion/);
	});

	test("rejects wrong schemaVersion", () => {
		const r = validateManifest({ ...MINIMAL, schemaVersion: 2 });
		expect(r.ok).toBe(false);
	});

	test("rejects missing name", () => {
		const r = validateManifest({ ...MINIMAL, name: "" });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.err).toMatch(/name/);
	});

	test("rejects missing version", () => {
		const r = validateManifest({ ...MINIMAL, version: "" });
		expect(r.ok).toBe(false);
	});

	test("rejects bad shader extension", () => {
		const r = validateManifest({ ...MINIMAL, shader: "shader.txt" });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.err).toMatch(/shader/);
	});

	test("rejects bad wasm extension", () => {
		const r = validateManifest({ ...MINIMAL, wasm: "pack.js" });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.err).toMatch(/wasm/);
	});

	test("rejects non-string author", () => {
		const r = validateManifest({ ...MINIMAL, author: 42 });
		expect(r.ok).toBe(false);
	});

	test("rejects non-string description", () => {
		const r = validateManifest({ ...MINIMAL, description: true });
		expect(r.ok).toBe(false);
	});

	// ---- parameters ----

	describe("parameters", () => {
		test("validates float parameter", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "float", name: "speed", min: 0, max: 4, default: 1 }],
			});
			expect(r.ok).toBe(true);
			if (r.ok) {
				expect(r.m.parameters![0].type).toBe("float");
				expect(r.m.parameters![0].name).toBe("speed");
			}
		});

		test("validates int parameter", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "int", name: "count", min: 1, max: 100, default: 10 }],
			});
			expect(r.ok).toBe(true);
		});

		test("validates bool parameter", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "bool", name: "flip", default: true }],
			});
			expect(r.ok).toBe(true);
		});

		test("validates enum parameter", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "enum", name: "mode", options: ["a", "b"], default: "a" }],
			});
			expect(r.ok).toBe(true);
		});

		test("validates color parameter", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "color", name: "tint", default: [1, 0.5, 0] }],
			});
			expect(r.ok).toBe(true);
		});

		test("validates range parameter", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "range", name: "freq", min: 0, max: 1, default: [0.2, 0.8] }],
			});
			expect(r.ok).toBe(true);
		});

		test("validates vec2/vec3/vec4 parameters", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [
					{ type: "vec2", name: "offset", default: [0, 0] },
					{ type: "vec3", name: "axis", default: [1, 0, 0] },
					{ type: "vec4", name: "color", default: [1, 1, 1, 1] },
				],
			});
			expect(r.ok).toBe(true);
			if (r.ok) expect(r.m.parameters!.length).toBe(3);
		});

		test("rejects invalid parameter name", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "float", name: "1bad", min: 0, max: 1, default: 0 }],
			});
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.err).toMatch(/parameters\[0\]/);
		});

		test("rejects duplicate parameter names", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [
					{ type: "float", name: "speed", min: 0, max: 1, default: 0 },
					{ type: "float", name: "speed", min: 0, max: 1, default: 0 },
				],
			});
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.err).toMatch(/duplicate/);
		});

		test("rejects float with min > max", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "float", name: "x", min: 10, max: 0, default: 5 }],
			});
			expect(r.ok).toBe(false);
		});

		test("rejects enum with default not in options", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "enum", name: "m", options: ["a", "b"], default: "c" }],
			});
			expect(r.ok).toBe(false);
		});

		test("rejects color with wrong array length", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "color", name: "c", default: [1, 0] }],
			});
			expect(r.ok).toBe(false);
		});

		test("rejects unknown parameter type", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "banana", name: "x", default: 0 }],
			});
			expect(r.ok).toBe(false);
		});
	});

	// ---- audio ----

	describe("audio", () => {
		test("accepts valid audio features", () => {
			const r = validateManifest({
				...MINIMAL,
				audio: { features: ["rms", "peak", "bass", "mid", "treble", "bpm", "beat_phase"] },
			});
			expect(r.ok).toBe(true);
			if (r.ok) expect(r.m.audio!.features!.length).toBe(7);
		});

		test("deduplicates audio features", () => {
			const r = validateManifest({
				...MINIMAL,
				audio: { features: ["bass", "bass", "mid"] },
			});
			expect(r.ok).toBe(true);
			if (r.ok) expect(r.m.audio!.features!.length).toBe(2);
		});

		test("rejects unknown audio feature", () => {
			const r = validateManifest({
				...MINIMAL,
				audio: { features: ["bass", "nope"] },
			});
			expect(r.ok).toBe(false);
		});

		test("rejects non-object audio", () => {
			const r = validateManifest({ ...MINIMAL, audio: "bass" });
			expect(r.ok).toBe(false);
		});
	});

	// ---- images ----

	describe("images", () => {
		test("accepts valid images", () => {
			const r = validateManifest({
				...MINIMAL,
				images: [
					{ name: "bg", file: "bg.png" },
					{ name: "mask", file: "mask.png" },
				],
			});
			expect(r.ok).toBe(true);
		});

		test("rejects path traversal in image file", () => {
			const r = validateManifest({
				...MINIMAL,
				images: [{ name: "bg", file: "../evil.png" }],
			});
			expect(r.ok).toBe(false);
		});

		test("rejects absolute path in image file", () => {
			const r = validateManifest({
				...MINIMAL,
				images: [{ name: "bg", file: "/etc/passwd" }],
			});
			expect(r.ok).toBe(false);
		});

		test("rejects duplicate image names", () => {
			const r = validateManifest({
				...MINIMAL,
				images: [
					{ name: "bg", file: "a.png" },
					{ name: "bg", file: "b.png" },
				],
			});
			expect(r.ok).toBe(false);
		});
	});

	// ---- tags ----

	test("rejects non-string tags", () => {
		const r = validateManifest({ ...MINIMAL, tags: [42] });
		expect(r.ok).toBe(false);
	});

	// ---- passes ----

	describe("passes", () => {
		test("accepts valid passes", () => {
			const r = validateManifest({
				...MINIMAL,
				passes: [{ shader: "bloom.wgsl" }, { shader: "blur.glsl" }],
			});
			expect(r.ok).toBe(true);
			if (r.ok) expect(r.m.passes!.length).toBe(2);
		});

		test("rejects pass with bad shader extension", () => {
			const r = validateManifest({
				...MINIMAL,
				passes: [{ shader: "bloom.txt" }],
			});
			expect(r.ok).toBe(false);
		});
	});

	// ---- presets ----

	describe("presets", () => {
		test("accepts valid presets referencing known params", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "float", name: "speed", min: 0, max: 4, default: 1 }],
				presets: [{ name: "Fast", values: { speed: 3.5 } }],
			});
			expect(r.ok).toBe(true);
			if (r.ok) {
				expect(r.m.presets![0].name).toBe("Fast");
				expect(r.m.presets![0].values.speed).toBe(3.5);
			}
		});

		test("strips unknown preset keys", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "float", name: "speed", min: 0, max: 4, default: 1 }],
				presets: [{ name: "X", values: { speed: 2, nope: 99 } }],
			});
			expect(r.ok).toBe(true);
			if (r.ok) {
				expect(r.m.presets![0].values.speed).toBe(2);
				expect(r.m.presets![0].values.nope).toBeUndefined();
			}
		});

		test("rejects duplicate preset names", () => {
			const r = validateManifest({
				...MINIMAL,
				parameters: [{ type: "float", name: "speed", min: 0, max: 4, default: 1 }],
				presets: [
					{ name: "A", values: { speed: 1 } },
					{ name: "A", values: { speed: 2 } },
				],
			});
			expect(r.ok).toBe(false);
			if (!r.ok) expect(r.err).toMatch(/duplicate/);
		});

		test("rejects preset with non-object values", () => {
			const r = validateManifest({
				...MINIMAL,
				presets: [{ name: "X", values: "bad" }],
			});
			expect(r.ok).toBe(false);
		});
	});
});

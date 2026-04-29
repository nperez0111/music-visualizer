import { describe, expect, test } from "bun:test";
import { validateManifest } from "./loader";

const minimal = {
	schemaVersion: 1,
	id: "test-pack",
	name: "Test Pack",
	version: "1.0.0",
	shader: "shader.wgsl",
};

describe("validateManifest", () => {
	test("accepts a minimal valid manifest", () => {
		const r = validateManifest(minimal);
		expect(r.ok).toBe(true);
	});

	test("rejects non-objects", () => {
		expect(validateManifest(null).ok).toBe(false);
		expect(validateManifest("string").ok).toBe(false);
		expect(validateManifest(42).ok).toBe(false);
	});

	test("rejects wrong schemaVersion", () => {
		const r = validateManifest({ ...minimal, schemaVersion: 2 });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.err).toMatch(/schemaVersion/);
	});

	test("rejects invalid id (path traversal, special chars)", () => {
		expect(validateManifest({ ...minimal, id: "../evil" }).ok).toBe(false);
		expect(validateManifest({ ...minimal, id: "with space" }).ok).toBe(false);
		expect(validateManifest({ ...minimal, id: "" }).ok).toBe(false);
	});

	test("rejects shader that isn't .wgsl", () => {
		const r = validateManifest({ ...minimal, shader: "shader.glsl" });
		expect(r.ok).toBe(false);
	});

	test("rejects missing name or version", () => {
		expect(validateManifest({ ...minimal, name: "" }).ok).toBe(false);
		expect(validateManifest({ ...minimal, version: undefined }).ok).toBe(false);
	});

	test("validates float parameters with min/max/default", () => {
		const r = validateManifest({
			...minimal,
			parameters: [{ type: "float", name: "x", min: 0, max: 1, default: 0.5 }],
		});
		expect(r.ok).toBe(true);
	});

	test("rejects float parameter with min > max", () => {
		const r = validateManifest({
			...minimal,
			parameters: [{ type: "float", name: "x", min: 1, max: 0, default: 0.5 }],
		});
		expect(r.ok).toBe(false);
	});

	test("rejects duplicate parameter names", () => {
		const r = validateManifest({
			...minimal,
			parameters: [
				{ type: "float", name: "x", min: 0, max: 1, default: 0.5 },
				{ type: "float", name: "x", min: 0, max: 2, default: 1.0 },
			],
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.err).toMatch(/duplicate/);
	});

	test("validates enum parameter requires default in options", () => {
		const ok = validateManifest({
			...minimal,
			parameters: [{ type: "enum", name: "mode", options: ["a", "b"], default: "a" }],
		});
		expect(ok.ok).toBe(true);
		const bad = validateManifest({
			...minimal,
			parameters: [{ type: "enum", name: "mode", options: ["a", "b"], default: "c" }],
		});
		expect(bad.ok).toBe(false);
	});

	test("validates color parameter shape (3 numbers)", () => {
		const ok = validateManifest({
			...minimal,
			parameters: [{ type: "color", name: "c", default: [1, 0, 0.5] }],
		});
		expect(ok.ok).toBe(true);
		const bad = validateManifest({
			...minimal,
			parameters: [{ type: "color", name: "c", default: [1, 0] }],
		});
		expect(bad.ok).toBe(false);
	});

	test("validates vec2/vec3/vec4 array length", () => {
		expect(
			validateManifest({
				...minimal,
				parameters: [{ type: "vec3", name: "v", default: [1, 2, 3] }],
			}).ok,
		).toBe(true);
		expect(
			validateManifest({
				...minimal,
				parameters: [{ type: "vec3", name: "v", default: [1, 2] }],
			}).ok,
		).toBe(false);
	});

	test("accepts presets and drops unknown parameter keys", () => {
		const r = validateManifest({
			...minimal,
			parameters: [{ type: "float", name: "size", min: 0, max: 1, default: 0.5 }],
			presets: [
				{ name: "Big", values: { size: 0.9, ghost: "should-be-dropped" } },
			],
		});
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.m.presets?.[0]?.name).toBe("Big");
			expect(r.m.presets?.[0]?.values).toEqual({ size: 0.9 });
		}
	});

	test("rejects preset without a name", () => {
		const r = validateManifest({
			...minimal,
			parameters: [{ type: "float", name: "size", min: 0, max: 1, default: 0.5 }],
			presets: [{ values: { size: 0.5 } }],
		});
		expect(r.ok).toBe(false);
	});

	test("rejects duplicate preset names", () => {
		const r = validateManifest({
			...minimal,
			parameters: [{ type: "float", name: "size", min: 0, max: 1, default: 0.5 }],
			presets: [
				{ name: "X", values: { size: 0.1 } },
				{ name: "X", values: { size: 0.9 } },
			],
		});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.err).toMatch(/duplicate/);
	});

	test("rejects preset values that aren't an object", () => {
		const r = validateManifest({
			...minimal,
			parameters: [{ type: "float", name: "size", min: 0, max: 1, default: 0.5 }],
			presets: [{ name: "X", values: [1, 2, 3] }],
		});
		expect(r.ok).toBe(false);
	});
});

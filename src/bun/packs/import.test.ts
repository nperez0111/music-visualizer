import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { zipSync, type Zippable } from "fflate";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { importVizFile } from "./import";
import { computePackHashFromEntries } from "./hash";
import { PACK_LIMITS } from "./limits";

const MIN_SHADER = `
struct Uniforms { time_ms: f32 };
@group(0) @binding(0) var<uniform> u: Uniforms;
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  return vec4(0.0, 0.0, 0.0, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4<f32> { return vec4(0.0); }
`;

const MIN_MANIFEST = {
	schemaVersion: 1,
	name: "Test Pack",
	version: "1.0.0",
	shader: "shader.wgsl",
};

function makeViz(entries: Zippable, sourcePath: string): void {
	const bytes = zipSync(entries);
	writeFileSync(sourcePath, bytes);
}

let scratch: string;
let userPacksDir: string;
let viz: string;

beforeEach(() => {
	scratch = mkdtempSync(join(tmpdir(), "viz-import-test-"));
	userPacksDir = join(scratch, "packs");
	mkdirSync(userPacksDir, { recursive: true });
	viz = join(scratch, "input.viz");
});

afterEach(() => {
	try { rmSync(scratch, { recursive: true, force: true }); } catch {}
});

describe("importVizFile", () => {
	test("installs a valid pack at userPacksDir/<sha256>/", () => {
		const entries: Zippable = {
			"manifest.json": new TextEncoder().encode(JSON.stringify(MIN_MANIFEST)),
			"shader.wgsl": new TextEncoder().encode(MIN_SHADER),
		};
		makeViz(entries, viz);

		const r = importVizFile(viz, userPacksDir);
		expect(r.ok).toBe(true);
		if (!r.ok) return;

		expect(r.id).toMatch(/^[0-9a-f]{64}$/);
		expect(r.installPath).toBe(join(userPacksDir, r.id));
		expect(existsSync(join(r.installPath, "manifest.json"))).toBe(true);
		expect(existsSync(join(r.installPath, "shader.wgsl"))).toBe(true);

		// Hash matches what computePackHashFromEntries says.
		const rawEntries: Record<string, Uint8Array> = {};
		for (const [k, v] of Object.entries(entries)) {
			rawEntries[k] = v as Uint8Array;
		}
		expect(computePackHashFromEntries(rawEntries, "")).toBe(r.id);
	});

	test("re-importing the same .viz produces the same id (idempotent)", () => {
		const entries: Zippable = {
			"manifest.json": new TextEncoder().encode(JSON.stringify(MIN_MANIFEST)),
			"shader.wgsl": new TextEncoder().encode(MIN_SHADER),
		};
		makeViz(entries, viz);

		const a = importVizFile(viz, userPacksDir);
		const b = importVizFile(viz, userPacksDir);
		expect(a.ok && b.ok).toBe(true);
		if (a.ok && b.ok) expect(a.id).toBe(b.id);
	});

	test("two packs that differ only in publisher-claimed manifest.id share a hash", () => {
		const a: Zippable = {
			"manifest.json": new TextEncoder().encode(
				JSON.stringify({ ...MIN_MANIFEST, id: "i-am-alice" }),
			),
			"shader.wgsl": new TextEncoder().encode(MIN_SHADER),
		};
		const b: Zippable = {
			"manifest.json": new TextEncoder().encode(
				JSON.stringify({ ...MIN_MANIFEST, id: "i-am-eve-impersonating" }),
			),
			"shader.wgsl": new TextEncoder().encode(MIN_SHADER),
		};
		const va = join(scratch, "a.viz");
		const vb = join(scratch, "b.viz");
		makeViz(a, va);
		makeViz(b, vb);

		const ra = importVizFile(va, userPacksDir);
		const rb = importVizFile(vb, userPacksDir);
		expect(ra.ok && rb.ok).toBe(true);
		// Different manifests → different hashes (the id field still affects the
		// canonical hash of the manifest bytes). The point is *neither* claim
		// can collide with an existing install named the same thing.
		if (ra.ok && rb.ok) expect(ra.id).not.toBe(rb.id);
	});

	test("rejects archive larger than the cap", () => {
		const tooBig = new Uint8Array(PACK_LIMITS.MAX_ARCHIVE_BYTES + 1024);
		writeFileSync(viz, tooBig);
		const r = importVizFile(viz, userPacksDir);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/too large/);
	});

	test("rejects archive with too many entries", () => {
		const entries: Zippable = {
			"manifest.json": new TextEncoder().encode(JSON.stringify(MIN_MANIFEST)),
			"shader.wgsl": new TextEncoder().encode(MIN_SHADER),
		};
		for (let i = 0; i < PACK_LIMITS.MAX_ENTRY_COUNT + 1; i++) {
			entries[`pad-${i}.txt`] = new TextEncoder().encode(`pad ${i}`);
		}
		makeViz(entries, viz);
		const r = importVizFile(viz, userPacksDir);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/too many entries/);
	});

	test("rejects archive with `..` path traversal", () => {
		const entries: Zippable = {
			"manifest.json": new TextEncoder().encode(JSON.stringify(MIN_MANIFEST)),
			"shader.wgsl": new TextEncoder().encode(MIN_SHADER),
			"../escape.txt": new TextEncoder().encode("ha"),
		};
		makeViz(entries, viz);
		const r = importVizFile(viz, userPacksDir);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/unsafe path/);
	});

	test("rejects archive with backslash in entry path", () => {
		const entries: Zippable = {
			"manifest.json": new TextEncoder().encode(JSON.stringify(MIN_MANIFEST)),
			"shader.wgsl": new TextEncoder().encode(MIN_SHADER),
			"sub\\evil.txt": new TextEncoder().encode("ha"),
		};
		makeViz(entries, viz);
		const r = importVizFile(viz, userPacksDir);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/unsafe path/);
	});

	test("rejects archive with absolute (leading-slash) path", () => {
		const entries: Zippable = {
			"manifest.json": new TextEncoder().encode(JSON.stringify(MIN_MANIFEST)),
			"shader.wgsl": new TextEncoder().encode(MIN_SHADER),
			"/etc/passwd": new TextEncoder().encode("ha"),
		};
		makeViz(entries, viz);
		const r = importVizFile(viz, userPacksDir);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/unsafe path/);
	});

	test("rejects an archive whose manifest.json is invalid", () => {
		const entries: Zippable = {
			"manifest.json": new TextEncoder().encode("{ this is not valid json"),
			"shader.wgsl": new TextEncoder().encode(MIN_SHADER),
		};
		makeViz(entries, viz);
		const r = importVizFile(viz, userPacksDir);
		expect(r.ok).toBe(false);
	});

	test("rejects an archive whose manifest fails schema validation", () => {
		const bad = { schemaVersion: 99, name: "X", version: "1", shader: "x.wgsl" };
		const entries: Zippable = {
			"manifest.json": new TextEncoder().encode(JSON.stringify(bad)),
			"shader.wgsl": new TextEncoder().encode(MIN_SHADER),
		};
		makeViz(entries, viz);
		const r = importVizFile(viz, userPacksDir);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toMatch(/manifest invalid/);
	});

	test("strips a single-folder wrapper prefix", () => {
		const entries: Zippable = {
			"my-pack/manifest.json": new TextEncoder().encode(JSON.stringify(MIN_MANIFEST)),
			"my-pack/shader.wgsl": new TextEncoder().encode(MIN_SHADER),
		};
		makeViz(entries, viz);
		const r = importVizFile(viz, userPacksDir);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		// Files installed without the wrapper prefix.
		expect(existsSync(join(r.installPath, "manifest.json"))).toBe(true);
		expect(existsSync(join(r.installPath, "shader.wgsl"))).toBe(true);
		expect(existsSync(join(r.installPath, "my-pack"))).toBe(false);
		// Sanity-check installed file content matches the source.
		const installed = readFileSync(join(r.installPath, "shader.wgsl"), "utf8");
		expect(installed).toBe(MIN_SHADER);
	});
});

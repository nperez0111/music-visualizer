import { describe, test, expect } from "bun:test";
import { computePackHash, computePackHashFromDir, isPackHash } from "./hash";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("computePackHash", () => {
	test("produces a 64-char hex string", () => {
		const entries: Record<string, Uint8Array> = {
			"shader.wgsl": new TextEncoder().encode("fn main() {}"),
		};
		const hash = computePackHash(entries, "");
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	test("excludes manifest.json", () => {
		const base: Record<string, Uint8Array> = {
			"shader.wgsl": new TextEncoder().encode("fn main() {}"),
		};
		const withManifest: Record<string, Uint8Array> = {
			...base,
			"manifest.json": new TextEncoder().encode('{"name":"x"}'),
		};
		expect(computePackHash(base, "")).toBe(computePackHash(withManifest, ""));
	});

	test("same content produces same hash", () => {
		const a: Record<string, Uint8Array> = {
			"shader.wgsl": new TextEncoder().encode("hello"),
		};
		const b: Record<string, Uint8Array> = {
			"shader.wgsl": new TextEncoder().encode("hello"),
		};
		expect(computePackHash(a, "")).toBe(computePackHash(b, ""));
	});

	test("different content produces different hash", () => {
		const a: Record<string, Uint8Array> = {
			"shader.wgsl": new TextEncoder().encode("hello"),
		};
		const b: Record<string, Uint8Array> = {
			"shader.wgsl": new TextEncoder().encode("world"),
		};
		expect(computePackHash(a, "")).not.toBe(computePackHash(b, ""));
	});

	test("different filenames produce different hash", () => {
		const a: Record<string, Uint8Array> = {
			"a.wgsl": new TextEncoder().encode("hello"),
		};
		const b: Record<string, Uint8Array> = {
			"b.wgsl": new TextEncoder().encode("hello"),
		};
		expect(computePackHash(a, "")).not.toBe(computePackHash(b, ""));
	});

	test("respects prefix", () => {
		const entries: Record<string, Uint8Array> = {
			"pack/shader.wgsl": new TextEncoder().encode("hello"),
			"other/file.txt": new TextEncoder().encode("ignore me"),
		};
		const hashWithPrefix = computePackHash(entries, "pack/");
		const hashDirect: Record<string, Uint8Array> = {
			"shader.wgsl": new TextEncoder().encode("hello"),
		};
		expect(hashWithPrefix).toBe(computePackHash(hashDirect, ""));
	});

	test("skips directory entries (trailing slash)", () => {
		const entries: Record<string, Uint8Array> = {
			"subdir/": new Uint8Array(0),
			"shader.wgsl": new TextEncoder().encode("code"),
		};
		const without: Record<string, Uint8Array> = {
			"shader.wgsl": new TextEncoder().encode("code"),
		};
		expect(computePackHash(entries, "")).toBe(computePackHash(without, ""));
	});
});

describe("computePackHashFromDir", () => {
	let dir: string;

	test("matches in-memory hash for same content", () => {
		dir = mkdtempSync(join(tmpdir(), "hash-test-"));
		const shaderContent = "fn vs() {}";
		writeFileSync(join(dir, "manifest.json"), '{"schemaVersion":1}');
		writeFileSync(join(dir, "shader.wgsl"), shaderContent);

		const dirHash = computePackHashFromDir(dir);

		const memHash = computePackHash(
			{ "shader.wgsl": new TextEncoder().encode(shaderContent) },
			"",
		);

		expect(dirHash).toBe(memHash);
		rmSync(dir, { recursive: true, force: true });
	});

	test("handles nested files", () => {
		dir = mkdtempSync(join(tmpdir(), "hash-test-"));
		writeFileSync(join(dir, "manifest.json"), "{}");
		writeFileSync(join(dir, "shader.wgsl"), "code");
		mkdirSync(join(dir, "sub"));
		writeFileSync(join(dir, "sub/extra.wgsl"), "more code");

		const hash = computePackHashFromDir(dir);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		rmSync(dir, { recursive: true, force: true });
	});
});

describe("isPackHash", () => {
	test("accepts valid 64-char hex", () => {
		expect(isPackHash("a".repeat(64))).toBe(true);
		expect(isPackHash("0123456789abcdef".repeat(4))).toBe(true);
	});

	test("rejects short strings", () => {
		expect(isPackHash("abc")).toBe(false);
	});

	test("rejects uppercase", () => {
		expect(isPackHash("A".repeat(64))).toBe(false);
	});

	test("rejects non-hex chars", () => {
		expect(isPackHash("g" + "a".repeat(63))).toBe(false);
	});
});

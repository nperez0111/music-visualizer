import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { zipSync } from "fflate";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "cli-info-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("catnip info", () => {
	test("reads info from a pack directory", async () => {
		const packDir = join(tmpDir, "test-pack");
		mkdirSync(packDir);
		writeFileSync(
			join(packDir, "manifest.json"),
			JSON.stringify({
				schemaVersion: 1,
				name: "Test Pack",
				version: "2.0.0",
				author: "Bob",
				shader: "shader.wgsl",
			}),
		);
		writeFileSync(join(packDir, "shader.wgsl"), "fn main() {}");

		const { run } = await import("./info.ts");
		// Should not throw
		await run([packDir]);
	});

	test("reads info from a .viz archive", async () => {
		const manifest = JSON.stringify({
			schemaVersion: 1,
			name: "Archive Pack",
			version: "1.0.0",
			shader: "shader.wgsl",
		});
		const shader = "fn main() {}";

		const vizBytes = zipSync({
			"manifest.json": new TextEncoder().encode(manifest),
			"shader.wgsl": new TextEncoder().encode(shader),
		});

		const vizPath = join(tmpDir, "test.viz");
		writeFileSync(vizPath, vizBytes);

		const { run } = await import("./info.ts");
		await run([vizPath]);
	});

	test("reads info from a .viz with a wrapper directory", async () => {
		const manifest = JSON.stringify({
			schemaVersion: 1,
			name: "Wrapped Pack",
			version: "1.0.0",
			shader: "shader.wgsl",
		});

		const vizBytes = zipSync({
			"pack/manifest.json": new TextEncoder().encode(manifest),
			"pack/shader.wgsl": new TextEncoder().encode("fn main() {}"),
		});

		const vizPath = join(tmpDir, "wrapped.viz");
		writeFileSync(vizPath, vizBytes);

		const { run } = await import("./info.ts");
		await run([vizPath]);
	});

	test("fails on missing path", async () => {
		const { run } = await import("./info.ts");
		expect(run([join(tmpDir, "nonexistent.viz")])).rejects.toThrow(/not found/i);
	});

	test("fails on archive without manifest", async () => {
		const vizBytes = zipSync({
			"shader.wgsl": new TextEncoder().encode("fn main() {}"),
		});
		const vizPath = join(tmpDir, "no-manifest.viz");
		writeFileSync(vizPath, vizBytes);

		const { run } = await import("./info.ts");
		expect(run([vizPath])).rejects.toThrow(/manifest\.json/);
	});

	test("produces same hash from dir and archive", async () => {
		const shaderContent = "fn vs_main() { }";
		const manifestContent = JSON.stringify({
			schemaVersion: 1,
			name: "Hash Test",
			version: "1.0.0",
			shader: "shader.wgsl",
		});

		// Create dir version
		const packDir = join(tmpDir, "hash-pack");
		mkdirSync(packDir);
		writeFileSync(join(packDir, "manifest.json"), manifestContent);
		writeFileSync(join(packDir, "shader.wgsl"), shaderContent);

		// Create archive version
		const vizBytes = zipSync({
			"manifest.json": new TextEncoder().encode(manifestContent),
			"shader.wgsl": new TextEncoder().encode(shaderContent),
		});
		const vizPath = join(tmpDir, "hash-test.viz");
		writeFileSync(vizPath, vizBytes);

		// Both should produce the same hash — verify by capturing console output
		const { computePackHashFromDir, computePackHash } = await import("@catnip/shared/hash");
		const { unzipSync } = await import("fflate");

		const dirHash = computePackHashFromDir(packDir);
		const entries = unzipSync(new Uint8Array(readFileSync(vizPath)));
		const archiveHash = computePackHash(entries, "");

		expect(dirHash).toBe(archiveHash);
	});
});

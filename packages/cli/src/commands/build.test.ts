import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { unzipSync } from "fflate";

let tmpDir: string;
let packDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "cli-build-"));
	packDir = join(tmpDir, "test-pack");
	require("fs").mkdirSync(packDir);

	writeFileSync(
		join(packDir, "manifest.json"),
		JSON.stringify({
			schemaVersion: 1,
			name: "Test Pack",
			version: "1.0.0",
			shader: "shader.wgsl",
		}),
	);
	writeFileSync(join(packDir, "shader.wgsl"), "fn vs_main() {}");
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("catnip build", () => {
	test("creates a .viz archive from a valid pack directory", async () => {
		const { run } = await import("./build.ts");
		const outPath = join(tmpDir, "out.viz");
		await run([packDir, "--out", outPath]);

		expect(existsSync(outPath)).toBe(true);

		// Verify it's a valid zip containing the right files
		const bytes = new Uint8Array(readFileSync(outPath));
		const entries = unzipSync(bytes);
		const keys = Object.keys(entries).sort();
		expect(keys).toContain("manifest.json");
		expect(keys).toContain("shader.wgsl");
	});

	test("defaults output to <slug>.viz in cwd", async () => {
		const { run } = await import("./build.ts");
		const originalCwd = process.cwd();
		process.chdir(tmpDir);
		try {
			await run([packDir]);
			expect(existsSync(join(tmpDir, "test-pack.viz"))).toBe(true);
		} finally {
			process.chdir(originalCwd);
		}
	});

	test("fails on missing manifest", async () => {
		const { run } = await import("./build.ts");
		const emptyDir = join(tmpDir, "empty");
		require("fs").mkdirSync(emptyDir);

		expect(run([emptyDir])).rejects.toThrow(/manifest\.json/);
	});

	test("fails on missing shader file", async () => {
		const { run } = await import("./build.ts");
		require("fs").unlinkSync(join(packDir, "shader.wgsl"));

		expect(run([packDir])).rejects.toThrow(/Shader file not found/);
	});

	test("fails on invalid manifest", async () => {
		const { run } = await import("./build.ts");
		writeFileSync(
			join(packDir, "manifest.json"),
			JSON.stringify({ schemaVersion: 2, name: "X", version: "1", shader: "s.wgsl" }),
		);

		expect(run([packDir])).rejects.toThrow(/Invalid manifest/);
	});
});

import { describe, test, expect, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tmpDir: string;

afterEach(() => {
	if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe("catnip create", () => {
	test("scaffolds a GLSL pack by default", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "cli-create-"));
		const { run } = await import("./create.ts");
		await run(["my-pack", "--dir", tmpDir]);

		const packDir = join(tmpDir, "my-pack");
		expect(existsSync(join(packDir, "manifest.json"))).toBe(true);
		expect(existsSync(join(packDir, "shader.glsl"))).toBe(true);

		const manifest = JSON.parse(readFileSync(join(packDir, "manifest.json"), "utf8"));
		expect(manifest.schemaVersion).toBe(1);
		expect(manifest.name).toBe("My Pack");
		expect(manifest.version).toBe("0.1.0");
		expect(manifest.shader).toBe("shader.glsl");
		expect(manifest.tags).toContain("glsl");
	});

	test("scaffolds a WGSL pack with --lang wgsl", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "cli-create-"));
		const { run } = await import("./create.ts");
		await run(["wgsl-pack", "--dir", tmpDir, "--lang", "wgsl"]);

		const packDir = join(tmpDir, "wgsl-pack");
		expect(existsSync(join(packDir, "shader.wgsl"))).toBe(true);
		expect(existsSync(join(packDir, "shader.glsl"))).toBe(false);

		const manifest = JSON.parse(readFileSync(join(packDir, "manifest.json"), "utf8"));
		expect(manifest.shader).toBe("shader.wgsl");
		expect(manifest.tags).toBeUndefined(); // no "glsl" tag for wgsl packs
	});

	test("includes author and description when provided", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "cli-create-"));
		const { run } = await import("./create.ts");
		await run(["cool-viz", "--dir", tmpDir, "--author", "Alice", "--description", "A cool viz"]);

		const manifest = JSON.parse(readFileSync(join(tmpDir, "cool-viz/manifest.json"), "utf8"));
		expect(manifest.author).toBe("Alice");
		expect(manifest.description).toBe("A cool viz");
	});

	test("rejects invalid slug", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "cli-create-"));
		const { run } = await import("./create.ts");

		expect(run(["Bad_Slug!", "--dir", tmpDir])).rejects.toThrow(/Invalid slug/);
	});

	test("rejects slug starting with number", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "cli-create-"));
		const { run } = await import("./create.ts");

		expect(run(["1bad", "--dir", tmpDir])).rejects.toThrow(/Invalid slug/);
	});

	test("fails if directory already exists", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "cli-create-"));
		require("fs").mkdirSync(join(tmpDir, "existing"));
		const { run } = await import("./create.ts");

		expect(run(["existing", "--dir", tmpDir])).rejects.toThrow(/already exists/);
	});

	test("rejects unknown language", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "cli-create-"));
		const { run } = await import("./create.ts");

		expect(run(["test-pack", "--dir", tmpDir, "--lang", "hlsl"])).rejects.toThrow(/Unknown language/);
	});

	test("fails when no slug provided", async () => {
		const { run } = await import("./create.ts");
		expect(run([])).rejects.toThrow(/slug is required/);
	});

	test("converts slug to title case for name", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "cli-create-"));
		const { run } = await import("./create.ts");
		await run(["neon-tunnel-3d", "--dir", tmpDir]);

		const manifest = JSON.parse(readFileSync(join(tmpDir, "neon-tunnel-3d/manifest.json"), "utf8"));
		expect(manifest.name).toBe("Neon Tunnel 3d");
	});
});

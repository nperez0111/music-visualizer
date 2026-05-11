import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tmpDir: string;
let packDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "cli-validate-"));
	packDir = join(tmpDir, "test-pack");
	mkdirSync(packDir);
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("catnip validate", () => {
	test("validates a valid pack", async () => {
		writeFileSync(
			join(packDir, "manifest.json"),
			JSON.stringify({
				schemaVersion: 1,
				name: "Test",
				version: "1.0.0",
				shader: "shader.wgsl",
			}),
		);
		writeFileSync(join(packDir, "shader.wgsl"), "fn main() {}");

		const { run } = await import("./validate.ts");
		// Should not throw
		await run([packDir]);
	});

	test("fails on missing manifest", async () => {
		const { run } = await import("./validate.ts");
		expect(run([packDir])).rejects.toThrow(/manifest\.json/);
	});

	test("fails on invalid JSON", async () => {
		writeFileSync(join(packDir, "manifest.json"), "not json{{{");

		const { run } = await import("./validate.ts");
		expect(run([packDir])).rejects.toThrow(/not valid JSON/);
	});

	test("fails on invalid manifest", async () => {
		writeFileSync(
			join(packDir, "manifest.json"),
			JSON.stringify({ schemaVersion: 99, name: "X", version: "1", shader: "s.wgsl" }),
		);

		const { run } = await import("./validate.ts");
		expect(run([packDir])).rejects.toThrow(/Manifest validation failed/);
	});

	test("fails on missing shader file", async () => {
		writeFileSync(
			join(packDir, "manifest.json"),
			JSON.stringify({
				schemaVersion: 1,
				name: "Test",
				version: "1.0.0",
				shader: "shader.wgsl",
			}),
		);
		// Don't create shader.wgsl

		const { run } = await import("./validate.ts");
		expect(run([packDir])).rejects.toThrow(/Missing files/);
	});

	test("fails on missing pass shader", async () => {
		writeFileSync(
			join(packDir, "manifest.json"),
			JSON.stringify({
				schemaVersion: 1,
				name: "Test",
				version: "1.0.0",
				shader: "shader.wgsl",
				passes: [{ shader: "bloom.wgsl" }],
			}),
		);
		writeFileSync(join(packDir, "shader.wgsl"), "fn main() {}");
		// Don't create bloom.wgsl

		const { run } = await import("./validate.ts");
		expect(run([packDir])).rejects.toThrow(/Missing files/);
	});

	test("defaults to current directory", async () => {
		writeFileSync(
			join(packDir, "manifest.json"),
			JSON.stringify({
				schemaVersion: 1,
				name: "Test",
				version: "1.0.0",
				shader: "shader.wgsl",
			}),
		);
		writeFileSync(join(packDir, "shader.wgsl"), "fn main() {}");

		const { run } = await import("./validate.ts");
		const originalCwd = process.cwd();
		process.chdir(packDir);
		try {
			await run([]);
		} finally {
			process.chdir(originalCwd);
		}
	});
});

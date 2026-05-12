/**
 * Stress-test the GLSL → WGSL transpiler against a batch of complex shaders.
 * Usage: bun scripts/stress-test-transpiler.ts
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { transpileGlslToWgsl } from "../src/bun/packs/glsl-transpile";

const DIRS = ["shaders", "test-shaders/glsl-edge-cases"];

interface Result {
	file: string;
	ok: boolean;
	stage?: string;
	error?: string;
	wgslLength?: number;
	hasVsMain?: boolean;
	hasFsMain?: boolean;
}

const results: Result[] = [];

for (const dir of DIRS) {
	const fullDir = join(import.meta.dir, "..", dir);
	if (!existsSync(fullDir)) continue;

	const files = readdirSync(fullDir).filter(
		(f) => f.endsWith(".glsl") || f.endsWith(".frag"),
	);

	for (const file of files.sort()) {
		const path = join(fullDir, file);
		const src = readFileSync(path, "utf8");
		const label = `${dir}/${file}`;

		const r = transpileGlslToWgsl(src);

		if (r.ok) {
			results.push({
				file: label,
				ok: true,
				wgslLength: r.wgsl.length,
				hasVsMain: r.wgsl.includes("fn vs_main"),
				hasFsMain: r.wgsl.includes("fn fs_main"),
			});
		} else {
			results.push({
				file: label,
				ok: false,
				stage: r.stage,
				error: r.error.slice(0, 200),
			});
		}
	}
}

// Print summary
console.log("\n=== GLSL Transpiler Stress Test Results ===\n");

const passed = results.filter((r) => r.ok);
const failed = results.filter((r) => !r.ok);

for (const r of results) {
	if (r.ok) {
		const warnings: string[] = [];
		if (!r.hasVsMain) warnings.push("MISSING vs_main");
		if (!r.hasFsMain) warnings.push("MISSING fs_main");
		const warn = warnings.length ? ` [${warnings.join(", ")}]` : "";
		console.log(`  PASS  ${r.file} (${r.wgslLength} chars)${warn}`);
	} else {
		console.log(`  FAIL  ${r.file} [${r.stage}]`);
		console.log(`        ${r.error}`);
	}
}

console.log(
	`\n${passed.length}/${results.length} passed, ${failed.length} failed\n`,
);

if (failed.length > 0) {
	console.log("Failed shaders:");
	for (const r of failed) {
		console.log(`  - ${r.file} (${r.stage}): ${r.error?.slice(0, 120)}`);
	}
}

process.exit(failed.length > 0 ? 1 : 0);

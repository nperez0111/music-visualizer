#!/usr/bin/env bun
// Builds packs:
//   1. GLSL → WGSL transpilation for any pack whose manifest references .glsl
//   2. Tier 2 WASM compilation (pack.ts → pack.wasm via AssemblyScript)

import { Glob } from "bun";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transpileGlslToWgsl } from "../src/bun/packs/glsl-transpile";

const PACKS_DIR = "src/packs";

let failed = 0;

// ---------------------------------------------------------------------------
// Phase 1: GLSL → WGSL transpilation
// ---------------------------------------------------------------------------

const glslPacks = Array.from(new Glob("*/manifest.json").scanSync(PACKS_DIR))
	.map((rel) => rel.split("/")[0]!)
	.sort();

let glslCount = 0;
for (const id of glslPacks) {
	const manifestPath = join(PACKS_DIR, id, "manifest.json");
	if (!existsSync(manifestPath)) continue;

	let manifest: Record<string, unknown>;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		continue;
	}

	const mainIsGlsl = typeof manifest.shader === "string" && (manifest.shader as string).endsWith(".glsl");
	const passShaders: string[] = [];
	if (Array.isArray(manifest.passes)) {
		for (const pass of manifest.passes as Array<Record<string, unknown>>) {
			if (typeof pass?.shader === "string" && pass.shader.endsWith(".glsl")) {
				passShaders.push(pass.shader);
			}
		}
	}
	if (!mainIsGlsl && passShaders.length === 0) continue;

	const params = Array.isArray(manifest.parameters)
		? (manifest.parameters as Array<{ name: string }>)
		: undefined;

	glslCount++;

	// Transpile main shader
	if (mainIsGlsl) {
		const shader = manifest.shader as string;
		const glslPath = join(PACKS_DIR, id, shader);
		if (!existsSync(glslPath)) {
			console.error(`[build:packs] ${id}: GLSL file missing: ${shader}`);
			failed++;
			continue;
		}
		const glslSrc = readFileSync(glslPath, "utf8");
		const tr = transpileGlslToWgsl(glslSrc, { parameters: params });
		if (!tr.ok) {
			console.error(`[build:packs] ${id}: GLSL transpilation failed for ${shader} (${tr.stage}): ${tr.error}`);
			failed++;
			continue;
		}
		const wgslName = shader.replace(/\.glsl$/, ".wgsl");
		const wgslPath = join(PACKS_DIR, id, wgslName);
		writeFileSync(wgslPath, tr.wgsl, "utf8");
		console.log(`[build:packs] ${id}: ${shader} → ${wgslName}`);
	}

	// Transpile extra-pass shaders
	for (const shader of passShaders) {
		const glslPath = join(PACKS_DIR, id, shader);
		if (!existsSync(glslPath)) {
			console.error(`[build:packs] ${id}: GLSL file missing: ${shader}`);
			failed++;
			continue;
		}
		const glslSrc = readFileSync(glslPath, "utf8");
		const tr = transpileGlslToWgsl(glslSrc, { parameters: params, interPass: true });
		if (!tr.ok) {
			console.error(`[build:packs] ${id}: GLSL transpilation failed for ${shader} (${tr.stage}): ${tr.error}`);
			failed++;
			continue;
		}
		const wgslName = shader.replace(/\.glsl$/, ".wgsl");
		const wgslPath = join(PACKS_DIR, id, wgslName);
		writeFileSync(wgslPath, tr.wgsl, "utf8");
		console.log(`[build:packs] ${id}: ${shader} → ${wgslName}`);
	}
}

if (glslCount > 0) {
	console.log(`[build:packs] transpiled GLSL for ${glslCount} pack(s)`);
}

// ---------------------------------------------------------------------------
// Phase 2: Tier 2 WASM compilation
// ---------------------------------------------------------------------------

const tier2Packs = Array.from(new Glob("*/pack.ts").scanSync(PACKS_DIR))
	.map((rel) => rel.split("/")[0]!)
	.sort();

if (tier2Packs.length === 0 && glslCount === 0) {
	console.log("[build:packs] no Tier 2 or GLSL packs found");
	process.exit(0);
}

if (tier2Packs.length > 0) {
	console.log(`[build:packs] building ${tier2Packs.length} WASM pack(s): ${tier2Packs.join(", ")}`);
}

for (const id of tier2Packs) {
	const entry = `${PACKS_DIR}/${id}/pack.ts`;
	const out = `${PACKS_DIR}/${id}/pack.wasm`;
	const result = spawnSync(
		"bunx",
		["asc", entry, "--target", "release", "--runtime", "stub", "--exportRuntime", "-o", out],
		{ stdio: "inherit" },
	);
	if (result.status !== 0) {
		console.error(`[build:packs] FAILED ${id}`);
		failed++;
	}
}

if (failed > 0) {
	console.error(`[build:packs] ${failed} pack(s) failed`);
	process.exit(1);
}
console.log(`[build:packs] OK`);

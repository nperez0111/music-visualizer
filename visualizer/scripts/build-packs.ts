#!/usr/bin/env bun
// Builds every Tier 2 pack: each `src/packs/<id>/pack.ts` is compiled to
// `pack.wasm` via AssemblyScript. Tier 1 (shader-only) packs are skipped.

import { Glob } from "bun";
import { spawnSync } from "node:child_process";

const PACKS_DIR = "src/packs";

const tier2Packs = Array.from(new Glob("*/pack.ts").scanSync(PACKS_DIR))
	.map((rel) => rel.split("/")[0]!)
	.sort();

if (tier2Packs.length === 0) {
	console.log("[build:packs] no Tier 2 packs found");
	process.exit(0);
}

console.log(`[build:packs] building ${tier2Packs.length} pack(s): ${tier2Packs.join(", ")}`);

let failed = 0;
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

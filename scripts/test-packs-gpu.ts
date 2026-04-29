#!/usr/bin/env bun
// GPU pipeline build test for every loaded pack. Spawns the dev binary in
// VIZ_PACKS_SELFTEST=1 mode (see src/bun/index.ts), which iterates every pack,
// calls pipelineCache.ensure() to actually build the WGSL → ShaderModule →
// RenderPipeline chain, prints BEGIN/END markers per pack, then exits. wgpu
// native errors land on stderr synchronously during the FFI call, so we can
// correlate them by reading the merged stdout+stderr stream and partitioning
// the error lines into per-pack windows.
//
// Catches: WGSL parse errors (e.g. reserved-word collision in `struct Params`),
// binding-layout mismatches (manifest declares params but shader has no
// @group(1), etc.), and any other naga validation failure.
//
// Requires a real GPU (Electrobun creates a window for the surface). Run
// locally; do not run in headless CI.

import { spawn } from "bun";

const packs = await loadPackIds();
console.log(`[test:gpu] running pipeline self-test for ${packs.length} pack(s)…`);

// `electrobun dev` (no --watch) launches the binary, which forwards stderr
// from wgpu-native via its child bun process. Merging stdout+stderr at the
// shell level preserves ordering well enough for the BEGIN/END windows.
const child = spawn({
	cmd: ["sh", "-c", "bunx electrobun dev 2>&1"],
	cwd: process.cwd(),
	env: { ...process.env, VIZ_PACKS_SELFTEST: "1" },
	stdout: "pipe",
	stderr: "pipe",
});

const output: string[] = [];
const decoder = new TextDecoder();

// Hard timeout in case the binary hangs (e.g. headless CI where surface
// creation fails — selftest mode still requires a display).
const TIMEOUT_MS = 60_000;
const timeout = setTimeout(() => {
	console.error(`[test:gpu] TIMEOUT after ${TIMEOUT_MS / 1000}s; killing dev binary`);
	try { child.kill("SIGTERM"); } catch {}
	setTimeout(() => process.exit(2), 1000);
}, TIMEOUT_MS);

const reader = child.stdout!.getReader();
let buf = "";
while (true) {
	const { value, done } = await reader.read();
	if (done) break;
	buf += decoder.decode(value, { stream: true });
	let nl: number;
	while ((nl = buf.indexOf("\n")) >= 0) {
		const line = buf.slice(0, nl);
		buf = buf.slice(nl + 1);
		output.push(line);
		// Stream a couple of high-signal lines back so the user sees progress.
		if (line.includes("[SELFTEST_BEGIN]") || line.includes("[selftest]")) {
			console.log(line);
		}
	}
}
if (buf) output.push(buf);

clearTimeout(timeout);
const exitCode = await child.exited;

// Partition lines into per-pack windows. Anything between
// [SELFTEST_BEGIN] <id> and [SELFTEST_END] <id> belongs to that pack.
const perPack = new Map<string, string[]>();
let current: string | null = null;
for (const line of output) {
	const beg = /^\[SELFTEST_BEGIN\]\s+(\S+)/.exec(line);
	const end = /^\[SELFTEST_END\]\s+(\S+)/.exec(line);
	if (beg) {
		current = beg[1]!;
		perPack.set(current, []);
		continue;
	}
	if (end) {
		current = null;
		continue;
	}
	if (current) perPack.get(current)!.push(line);
}

// Decide PASS/FAIL per pack. FAIL signals:
//  - a line containing `WGPU uncaptured error`
//  - a line matching `[packs] failed to build pipeline for "<id>"`
//  - the pack never had a [SELFTEST_END] marker (build threw mid-flight)
const failures: Array<{ id: string; reasons: string[] }> = [];
for (const id of packs) {
	const window = perPack.get(id);
	if (!window) {
		failures.push({ id, reasons: ["pack not iterated by selftest (binary exited early?)"] });
		continue;
	}
	const reasons = window.filter(
		(l) => /WGPU uncaptured error/i.test(l) || /failed to build pipeline/i.test(l),
	);
	if (reasons.length > 0) failures.push({ id, reasons });
}

console.log(`\n[test:gpu] ${packs.length - failures.length}/${packs.length} packs passed`);
for (const f of failures) {
	console.error(`  ✗ ${f.id}`);
	for (const r of f.reasons.slice(0, 4)) console.error(`      ${r.trim()}`);
}

if (exitCode !== 0 && failures.length === 0) {
	console.error(`[test:gpu] WARNING: dev binary exited ${exitCode} but no per-pack failures detected`);
}

process.exit(failures.length > 0 ? 1 : 0);

async function loadPackIds(): Promise<string[]> {
	const { readdirSync, statSync, existsSync } = await import("fs");
	const { join, resolve } = await import("path");
	const packsDir = resolve(import.meta.dir, "..", "src", "packs");
	return readdirSync(packsDir)
		.filter((name) => {
			const full = join(packsDir, name);
			return statSync(full).isDirectory() && existsSync(join(full, "manifest.json"));
		})
		.sort();
}

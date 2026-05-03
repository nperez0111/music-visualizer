#!/usr/bin/env bun
// Render a single visualizer pack headlessly to a PNG. Usage:
//
//   bun scripts/render-pack.ts <slug> [out.png]
//
// No window, no audio capture; deterministic synthetic features. Use this for
// debugging a pack's visual output (the PNG can be opened in any viewer or
// inspected by automated tools).
//
// Implementation note: electrobun's `electrobun/bun` module dlopens its native
// libraries (`libNativeWrapper.{dylib,so}`, `libwebgpu_dawn.{dylib,so}`) from
// CWD and reads `../Resources/version.json` at import time, and those libs
// have @rpath / RUNPATH dependencies that resolve relative to the `bun`
// executable's location. So we transparently re-exec ourselves with the
// bundled bun where everything lives next to each other. Run `bunx electrobun
// build --env=canary` (or `dev`) once to generate the bundle for your host.

import { existsSync } from "fs";
import { resolve } from "path";

const REPO_ROOT = resolve(import.meta.dir, "..");

/**
 * Locate the directory containing the bundled `bun` binary alongside its
 * native libraries. macOS uses an `.app/Contents/MacOS` layout produced by
 * `electrobun build`. Linux is simpler: `node_modules/electrobun/dist-linux-*`
 * already has bun + dylibs side-by-side, so we use it directly (Linux
 * electrobun produces a self-extracting installer for the build output, which
 * is the wrong shape for our use). `VIZ_BUNDLE_NATIVE_DIR` overrides everything,
 * for environments like Docker where the layout is custom.
 */
function findBundleNativeDir(): string | null {
	const override = process.env.VIZ_BUNDLE_NATIVE_DIR;
	if (override && existsSync(override)) return override;

	for (const c of [
		resolve(REPO_ROOT, "build/dev-macos-arm64/music-visualizer-dev.app/Contents/MacOS"),
		resolve(REPO_ROOT, "build/canary-macos-arm64/music-visualizer.app/Contents/MacOS"),
		resolve(REPO_ROOT, "node_modules/electrobun/dist-linux-arm64"),
		resolve(REPO_ROOT, "node_modules/electrobun/dist-linux-x64"),
	]) {
		if (existsSync(c)) return c;
	}
	return null;
}

const bundleDir = findBundleNativeDir();
if (!bundleDir) {
	console.error(
		"no electrobun bundle found.\n" +
		"on macOS: run `bunx electrobun dev` once to generate the dev bundle.\n" +
		"on Linux: run `bunx electrobun build --env=canary` to download dist-linux-*.\n" +
		"or set VIZ_BUNDLE_NATIVE_DIR to a directory containing bun + native libs.",
	);
	process.exit(2);
}

const bundledBun = resolve(bundleDir, "bun");
if (process.execPath !== bundledBun) {
	const { spawnSync } = await import("child_process");
	const res = spawnSync(bundledBun, [import.meta.path, ...process.argv.slice(2)], {
		cwd: bundleDir,
		stdio: "inherit",
	});
	process.exit(res.status ?? 1);
}

const args = process.argv.slice(2);
if (args.length < 1) {
	console.error("usage: bun scripts/render-pack.ts <slug> [out.png]");
	process.exit(2);
}
const target = args[0]!;
const outPath = resolve(args[1] ?? `/tmp/${target}.png`);

const { loadPacksFromDir } = await import(resolve(REPO_ROOT, "src/bun/packs/loader.ts"));
const { renderPackToPng } = await import(resolve(REPO_ROOT, "src/bun/packs/headless-render.ts"));
const { instantiateWasmPack } = await import(resolve(REPO_ROOT, "src/bun/packs/runtime.ts"));
const { parameterFloatCount } = await import(resolve(REPO_ROOT, "src/bun/packs/parameters.ts"));
const { mkdirSync } = await import("fs");
const { dirname: pathDirname } = await import("path");

const packs = loadPacksFromDir(resolve(REPO_ROOT, "src/packs"), "builtin");
if (packs.length === 0) {
	console.error("no packs found in src/packs");
	process.exit(2);
}

const pack =
	packs.find((p: any) => p.id === target) ??
	packs.find((p: any) => p.path.endsWith(`/${target}`)) ??
	packs.find((p: any) => p.name === target);
if (!pack) {
	console.error(`no pack matching "${target}". Available slugs:`);
	for (const p of packs as any[]) console.error(`  ${p.path.split("/").pop()}  (${p.name})`);
	process.exit(1);
}

if (pack.wasmBytes && !pack.wasmRuntime) {
	pack.wasmRuntime = await instantiateWasmPack({
		packId: pack.id,
		bytes: pack.wasmBytes,
		parameterCount: parameterFloatCount(pack.parameters),
	});
}

mkdirSync(pathDirname(outPath), { recursive: true });

// Env overrides — useful for slow software-Vulkan backends (e.g. Mesa lavapipe
// in a container) where the 640x480 / 120-frame defaults are painful.
const w = Number(process.env.VIZ_RENDER_WIDTH);
const h = Number(process.env.VIZ_RENDER_HEIGHT);
const f = Number(process.env.VIZ_RENDER_FRAMES);

console.log(`[render-pack] rendering "${pack.name}" → ${outPath}`);
const t0 = performance.now();
await renderPackToPng({
	pack,
	outPath,
	width: Number.isFinite(w) && w > 0 ? w : undefined,
	height: Number.isFinite(h) && h > 0 ? h : undefined,
	frames: Number.isFinite(f) && f > 0 ? f : undefined,
});
const ms = Math.round(performance.now() - t0);
console.log(`[render-pack] done in ${ms}ms`);

if (pack.wasmRuntime) pack.wasmRuntime.dispose();
process.exit(0);

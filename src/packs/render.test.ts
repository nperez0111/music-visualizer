// Headless render-to-PNG smoke test. Boots wgpu without a window, draws each
// pack with deterministic synthetic features, and asserts:
//   * the PNG decodes (magic + dimensions match)
//   * a minimum fraction of pixels is "non-trivial" — to catch the case where
//     the shader compiles but draws nothing
//
// Gated on VIZ_PACKS_RENDER_TEST=1 because it requires (a) the bundled bun
// executable inside an electrobun build, and (b) a real GPU. CI must invoke
// this with the bundled bun, e.g.:
//
//   build/.../music-visualizer-dev.app/Contents/MacOS/bun test src/packs/render.test.ts
//
// otherwise the electrobun runtime imports it depends on will fail at module-load.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "fs";
import { dirname, resolve } from "path";

const SHOULD_RUN = process.env.VIZ_PACKS_RENDER_TEST === "1";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const PACKS_DIR = resolve(import.meta.dir);
const SNAPSHOTS_DIR = resolve(REPO_ROOT, "tests/snapshots/packs");

// Smaller frame than the CLI default — keeps the suite fast while still being
// large enough that "drew nothing" is unambiguously distinguishable from
// "drew a small number of bright pixels."
const RENDER_W = 320;
const RENDER_H = 240;
const RENDER_FRAMES = 60;

// Minimum compressed IDAT size, in bytes. A 320x240 RGBA frame that's all
// zeros (or one solid color) compresses to ~300 bytes; any real image with
// gradients or detail comfortably clears 2 KB. We're not after a tight bound,
// just "did the shader actually run."
const MIN_IDAT_BYTES = 2_000;

const describeIfRunning = SHOULD_RUN ? describe : describe.skip;

/** Resolve a directory containing bun + native libs side-by-side. macOS uses
 *  the `electrobun build` output; Linux uses `node_modules/electrobun/dist-linux-*`
 *  directly because the Linux build output is a self-extracting installer. The
 *  `VIZ_BUNDLE_NATIVE_DIR` env var overrides everything. */
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

describeIfRunning("packs/render", () => {
	test("renders every built-in pack to a non-empty PNG", async () => {
		// electrobun's runtime resolves native dylibs and a Resources/version.json
		// relative to CWD at module-load time, so we need to be inside a built
		// bundle's MacOS dir before any electrobun-touching code is imported.
		const bundleDir = findBundleNativeDir();
		if (!bundleDir) {
			throw new Error(
				"no electrobun bundle found; run `bunx electrobun dev` (macOS) or " +
				"`bunx electrobun build --env=canary` (Linux) first, or set " +
				"VIZ_BUNDLE_NATIVE_DIR.",
			);
		}
		process.chdir(bundleDir);

		const { loadPacksFromDir } = await import("../bun/packs/loader");
		const { renderPackToPng } = await import("../bun/packs/headless-render");
		const { instantiateWasmPack } = await import("../bun/packs/runtime");
		const { parameterFloatCount } = await import("../bun/packs/parameters");

		mkdirSync(SNAPSHOTS_DIR, { recursive: true });

		const packs = loadPacksFromDir(PACKS_DIR, "builtin");
		expect(packs.length).toBeGreaterThan(0);

		const failures: string[] = [];
		for (const pack of packs) {
			const slug = pack.path.split("/").pop()!;
			const outPath = resolve(SNAPSHOTS_DIR, `${slug}.png`);
			if (existsSync(outPath)) rmSync(outPath);

			if (pack.wasmBytes && !pack.wasmRuntime) {
				pack.wasmRuntime = await instantiateWasmPack({
					packId: pack.id,
					bytes: pack.wasmBytes,
					parameterCount: parameterFloatCount(pack.parameters),
				});
			}

			try {
				await renderPackToPng({
					pack,
					width: RENDER_W,
					height: RENDER_H,
					frames: RENDER_FRAMES,
					outPath,
				});
			} catch (err) {
				failures.push(`${slug}: render threw: ${(err as Error).message}`);
				if (pack.wasmRuntime) pack.wasmRuntime.dispose();
				continue;
			}

			const reason = inspectPng(outPath, RENDER_W, RENDER_H);
			if (reason) failures.push(`${slug}: ${reason}`);

			if (pack.wasmRuntime) pack.wasmRuntime.dispose();
		}

		if (failures.length > 0) {
			throw new Error(`${failures.length}/${packs.length} packs failed:\n  ${failures.join("\n  ")}`);
		}
	}, 120_000);

	test("renders every built-in pack to an animated WebP", async () => {
		const bundleDir = findBundleNativeDir();
		if (!bundleDir) {
			throw new Error(
				"no electrobun bundle found; run `bunx electrobun dev` (macOS) or " +
				"`bunx electrobun build --env=canary` (Linux) first, or set " +
				"VIZ_BUNDLE_NATIVE_DIR.",
			);
		}
		process.chdir(bundleDir);

		const { loadPacksFromDir } = await import("../bun/packs/loader");
		const { renderPackToWebP } = await import("../bun/packs/headless-render");
		const { instantiateWasmPack } = await import("../bun/packs/runtime");
		const { parameterFloatCount } = await import("../bun/packs/parameters");

		mkdirSync(SNAPSHOTS_DIR, { recursive: true });

		const packs = loadPacksFromDir(PACKS_DIR, "builtin");
		expect(packs.length).toBeGreaterThan(0);

		const failures: string[] = [];
		for (const pack of packs) {
			const slug = pack.path.split("/").pop()!;
			const outPath = resolve(SNAPSHOTS_DIR, `${slug}.webp`);
			if (existsSync(outPath)) rmSync(outPath);

			if (pack.wasmBytes && !pack.wasmRuntime) {
				pack.wasmRuntime = await instantiateWasmPack({
					packId: pack.id,
					bytes: pack.wasmBytes,
					parameterCount: parameterFloatCount(pack.parameters),
				});
			}

			try {
				await renderPackToWebP({
					pack,
					width: RENDER_W,
					height: RENDER_H,
					frames: RENDER_FRAMES,
					webpFrames: 15,
					duration: 100,
					outPath,
				});
			} catch (err) {
				failures.push(`${slug}: WebP render threw: ${(err as Error).message}`);
				if (pack.wasmRuntime) pack.wasmRuntime.dispose();
				continue;
			}

			const reason = inspectWebP(outPath);
			if (reason) failures.push(`${slug}: ${reason}`);

			if (pack.wasmRuntime) pack.wasmRuntime.dispose();
		}

		if (failures.length > 0) {
			throw new Error(`${failures.length}/${packs.length} WebP renders failed:\n  ${failures.join("\n  ")}`);
		}
	}, 180_000);
});

if (!SHOULD_RUN) {
	describe("packs/render (skipped)", () => {
		test("set VIZ_PACKS_RENDER_TEST=1 (and use the bundled bun) to run", () => {
			expect(SHOULD_RUN).toBe(false);
		});
	});
}

/** Returns null if the PNG passes the smoke checks, otherwise a reason string. */
function inspectPng(path: string, expectedW: number, expectedH: number): string | null {
	const bytes = readFileSync(path);
	if (bytes.length < 33) return "PNG too short";
	const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	for (let i = 0; i < 8; i++) {
		if (bytes[i] !== sig[i]) return "not a PNG (bad magic)";
	}
	// IHDR follows the signature: [length:4][type:4=IHDR][width:4][height:4]…
	const w = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
	const h = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
	if (w !== expectedW || h !== expectedH) return `dimensions ${w}x${h} != ${expectedW}x${expectedH}`;

	// Cheap non-empty proxy: a trivially-empty (uniform-color) frame compresses
	// to a few hundred bytes; any real shader output will produce multiple KB
	// of IDAT. We don't decode pixels — IDAT size is a tight enough signal for
	// "the pack drew at least something" without needing zlib here.
	const idatStart = findChunk(bytes, "IDAT");
	if (idatStart < 0) return "no IDAT chunk";
	const idatLen = (bytes[idatStart - 8]! << 24) | (bytes[idatStart - 7]! << 16)
		| (bytes[idatStart - 6]! << 8) | bytes[idatStart - 5]!;
	if (idatLen < MIN_IDAT_BYTES) {
		return `IDAT only ${idatLen} bytes (< ${MIN_IDAT_BYTES} threshold) — pack likely drew a uniform frame`;
	}
	return null;
}

/** Returns null if the WebP passes basic smoke checks, otherwise a reason string. */
function inspectWebP(path: string): string | null {
	const bytes = readFileSync(path);
	if (bytes.length < 12) return "WebP too short";
	// RIFF....WEBP header
	const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
	const webp = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!);
	if (riff !== "RIFF" || webp !== "WEBP") return `not a WebP (header: ${riff}...${webp})`;
	// Minimum size — an animated WebP at 320x240 with any content should be > 1KB
	if (bytes.length < 1000) return `WebP suspiciously small (${bytes.length} bytes)`;
	return null;
}

function findChunk(bytes: Uint8Array, type: string): number {
	let off = 8; // skip signature
	while (off + 8 <= bytes.length) {
		const len = (bytes[off]! << 24) | (bytes[off + 1]! << 16) | (bytes[off + 2]! << 8) | bytes[off + 3]!;
		const tag =
			String.fromCharCode(bytes[off + 4]!) +
			String.fromCharCode(bytes[off + 5]!) +
			String.fromCharCode(bytes[off + 6]!) +
			String.fromCharCode(bytes[off + 7]!);
		if (tag === type) return off + 8;
		off += 8 + len + 4;
	}
	return -1;
}

// Side-effect: silence the unused-variable warning if the dynamic imports above
// trip TS in some configs.
void dirname;

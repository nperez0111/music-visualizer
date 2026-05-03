#!/usr/bin/env bun
// Parameterized headless pack renderer for visual debugging. Usage:
//
//   bun scripts/render-pack-debug.ts <slug> [options]
//
// Options:
//   --out <path>              Output path (default /tmp/<slug>.png or .webp with --webp)
//   --width <n>               Image width (default 640)
//   --height <n>              Image height (default 480)
//   --frames <n>              Total frames to simulate (default 120)
//   --time <seconds>          Capture at a specific simulated time (overrides --frames)
//   --capture-frames <list>   Comma-separated frame indices for mid-render captures
//   --capture-times <list>    Comma-separated times (seconds) for mid-render captures
//   --capture-every <sec>     Capture every N seconds (use with --time or --frames)
//   --webp                    Output an animated WebP instead of a PNG
//   --webp-frames <n>         Number of frames to capture for the WebP (default 20)
//   --webp-duration <ms>      Duration of each WebP frame in ms (default 100)
//   --webp-quality <n>        WebP quality 0-100 (default 80)
//   --param <name>=<value>    Override a pack parameter (repeatable)
//   --preset <name>           Apply a named preset from the pack manifest
//   --audio <key>=<value>     Override audio features: rms, peak, bass, mid, treble,
//                             bpm, beat_phase (repeatable; constant across all frames)
//   --list-params             Print pack parameters/presets and exit
//   --list-packs              Print all available pack slugs and exit
//
// Examples:
//   bun scripts/render-pack-debug.ts bloom-pulse --time 3.5
//   bun scripts/render-pack-debug.ts bloom-pulse --param rings=20 --param bloomAmt=1.2
//   bun scripts/render-pack-debug.ts bloom-pulse --preset Inferno --out /tmp/inferno.png
//   bun scripts/render-pack-debug.ts bloom-pulse --capture-frames 0,30,60,90,119
//   bun scripts/render-pack-debug.ts bloom-pulse --capture-times 0,0.5,1.0,1.5,2.0
//   bun scripts/render-pack-debug.ts bloom-pulse --capture-every 0.5 --time 3.0
//   bun scripts/render-pack-debug.ts bloom-pulse --audio bass=1.0 --audio treble=0
//   bun scripts/render-pack-debug.ts bloom-pulse --webp --webp-frames 30 --webp-duration 80
//   bun scripts/render-pack-debug.ts --list-packs
//
// Like render-pack.ts, this re-execs itself with the bundled bun from an
// electrobun build so that native libraries resolve correctly.

import { existsSync } from "fs";
import { resolve } from "path";

const REPO_ROOT = resolve(import.meta.dir, "..");

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

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);

function flag(name: string): boolean {
	const idx = argv.indexOf(name);
	if (idx === -1) return false;
	argv.splice(idx, 1);
	return true;
}

function option(name: string): string | undefined {
	const idx = argv.indexOf(name);
	if (idx === -1 || idx + 1 >= argv.length) return undefined;
	const val = argv[idx + 1]!;
	argv.splice(idx, 2);
	return val;
}

function optionAll(name: string): string[] {
	const results: string[] = [];
	while (true) {
		const idx = argv.indexOf(name);
		if (idx === -1 || idx + 1 >= argv.length) break;
		results.push(argv[idx + 1]!);
		argv.splice(idx, 2);
	}
	return results;
}

const listPacks = flag("--list-packs");
const listParams = flag("--list-params");
const webpMode = flag("--webp");

const outOpt = option("--out");
const widthOpt = option("--width");
const heightOpt = option("--height");
const framesOpt = option("--frames");
const timeOpt = option("--time");
const captureFramesOpt = option("--capture-frames");
const captureTimesOpt = option("--capture-times");
const captureEveryOpt = option("--capture-every");
const webpFramesOpt = option("--webp-frames");
const webpDurationOpt = option("--webp-duration");
const webpQualityOpt = option("--webp-quality");
const presetOpt = option("--preset");
const paramRaw = optionAll("--param");
const audioRaw = optionAll("--audio");

// ---------------------------------------------------------------------------
// Load packs
// ---------------------------------------------------------------------------

const { loadPacksFromDir } = await import(resolve(REPO_ROOT, "src/bun/packs/loader.ts"));
const { renderPackToPng, renderPackToWebP, DEFAULT_RENDER_WIDTH, DEFAULT_RENDER_HEIGHT } = await import(resolve(REPO_ROOT, "src/bun/packs/headless-render.ts"));
const { instantiateWasmPack } = await import(resolve(REPO_ROOT, "src/bun/packs/runtime.ts"));
const { parameterFloatCount, coerceParameterValue } = await import(resolve(REPO_ROOT, "src/bun/packs/parameters.ts"));
const { mkdirSync } = await import("fs");
const { dirname: pathDirname } = await import("path");

const packs = loadPacksFromDir(resolve(REPO_ROOT, "src/packs"), "builtin");
if (packs.length === 0) {
	console.error("no packs found in src/packs");
	process.exit(2);
}

// --list-packs
if (listPacks) {
	console.log("Available packs:");
	for (const p of packs as any[]) {
		const slug = p.path.split("/").pop();
		const params = p.parameters?.length ? ` (${p.parameters.length} params)` : "";
		const presets = p.presets?.length ? ` [presets: ${p.presets.map((pr: any) => pr.name).join(", ")}]` : "";
		console.log(`  ${slug}  — ${p.name}${params}${presets}`);
	}
	process.exit(0);
}

// Resolve target pack
const target = argv.shift();
if (!target) {
	console.error(
		"usage: bun scripts/render-pack-debug.ts <slug> [options]\n" +
		"       bun scripts/render-pack-debug.ts --list-packs\n" +
		"       bun scripts/render-pack-debug.ts <slug> --list-params\n\n" +
		"Run with --list-packs to see available slugs."
	);
	process.exit(2);
}

const pack: any =
	packs.find((p: any) => p.id === target) ??
	packs.find((p: any) => p.path.endsWith(`/${target}`)) ??
	packs.find((p: any) => p.name === target);
if (!pack) {
	console.error(`no pack matching "${target}". Run with --list-packs to see available slugs.`);
	process.exit(1);
}

// --list-params
if (listParams) {
	console.log(`Pack: ${pack.name}`);
	if (!pack.parameters?.length) {
		console.log("  (no parameters)");
	} else {
		console.log("Parameters:");
		for (const p of pack.parameters) {
			const range = p.min != null ? ` [${p.min}..${p.max}]` : "";
			const def = Array.isArray(p.default) ? `[${p.default.join(",")}]` : String(p.default);
			const opts = p.options ? ` options: ${p.options.join(", ")}` : "";
			console.log(`  ${p.name} (${p.type})  default=${def}${range}${opts}`);
		}
	}
	if (pack.presets?.length) {
		console.log("Presets:");
		for (const pr of pack.presets) {
			const vals = Object.entries(pr.values).map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v}]` : v}`).join(", ");
			console.log(`  ${pr.name}: ${vals}`);
		}
	}
	process.exit(0);
}

// Warn about unknown argv
if (argv.length > 0) {
	console.error(`unknown arguments: ${argv.join(" ")}`);
	process.exit(2);
}

// ---------------------------------------------------------------------------
// Build render options
// ---------------------------------------------------------------------------

const width = widthOpt ? Number(widthOpt) : DEFAULT_RENDER_WIDTH;
const height = heightOpt ? Number(heightOpt) : DEFAULT_RENDER_HEIGHT;
const defaultExt = webpMode ? ".webp" : ".png";
const outPath = resolve(outOpt ?? `/tmp/${target}${defaultExt}`);

// Determine frames — --time overrides --frames
let frames = framesOpt ? Number(framesOpt) : 120;
if (timeOpt) {
	const timeSec = Number(timeOpt);
	if (!Number.isFinite(timeSec) || timeSec < 0) {
		console.error(`invalid --time value: ${timeOpt}`);
		process.exit(2);
	}
	// frames = ceil(time / dt) so the last frame lands at or just past the target time
	frames = Math.max(1, Math.ceil(timeSec * 60));
}

// Capture frames
let captureFrames: number[] | undefined;
if (captureFramesOpt) {
	captureFrames = captureFramesOpt.split(",").map((s) => {
		const n = Number(s.trim());
		if (!Number.isFinite(n) || n < 0 || n !== Math.floor(n)) {
			console.error(`invalid capture frame index: "${s}"`);
			process.exit(2);
		}
		return n;
	});
}

// Capture times (--capture-times 0,0.5,1.0 and --capture-every 0.5)
let captureTimesS: number[] | undefined;
if (captureTimesOpt) {
	captureTimesS = captureTimesOpt.split(",").map((s) => {
		const n = Number(s.trim());
		if (!Number.isFinite(n) || n < 0) {
			console.error(`invalid capture time: "${s}"`);
			process.exit(2);
		}
		return n;
	});
}
if (captureEveryOpt) {
	const interval = Number(captureEveryOpt);
	if (!Number.isFinite(interval) || interval <= 0) {
		console.error(`invalid --capture-every interval: "${captureEveryOpt}"`);
		process.exit(2);
	}
	// Determine the total duration to cover
	const totalSec = timeOpt ? Number(timeOpt) : frames / 60;
	if (!captureTimesS) captureTimesS = [];
	for (let t = 0; t <= totalSec + 1e-9; t += interval) {
		// Round to avoid floating-point drift (e.g. 0.30000000000000004)
		const rounded = Math.round(t * 1000) / 1000;
		captureTimesS.push(rounded);
	}
}

// Parameter overrides (--param name=value and --preset)
let paramOverrides: Record<string, any> | undefined;
if (presetOpt && pack.presets?.length) {
	const preset = pack.presets.find((pr: any) => pr.name === presetOpt);
	if (!preset) {
		console.error(`unknown preset "${presetOpt}". Available: ${pack.presets.map((pr: any) => pr.name).join(", ")}`);
		process.exit(1);
	}
	paramOverrides = { ...preset.values };
}
if (paramRaw.length > 0) {
	if (!paramOverrides) paramOverrides = {};
	for (const raw of paramRaw) {
		const eq = raw.indexOf("=");
		if (eq === -1) {
			console.error(`invalid --param format: "${raw}" (expected name=value)`);
			process.exit(2);
		}
		const name = raw.slice(0, eq);
		const valueStr = raw.slice(eq + 1);
		const paramDef = pack.parameters?.find((p: any) => p.name === name);
		if (!paramDef) {
			console.error(`unknown parameter "${name}" for pack "${pack.name}". Use --list-params to see available parameters.`);
			process.exit(1);
		}
		// Parse the value string into the appropriate type
		let parsed: any;
		if (valueStr.startsWith("[") && valueStr.endsWith("]")) {
			// Bracketed array value: [1,0.5,0.9]
			parsed = valueStr.slice(1, -1).split(",").map(Number);
		} else if (valueStr === "true") {
			parsed = true;
		} else if (valueStr === "false") {
			parsed = false;
		} else if (
			["color", "range", "vec2", "vec3", "vec4"].includes(paramDef.type) &&
			valueStr.includes(",")
		) {
			// Bare comma-separated numbers for vector/color types: 0,1,0.5
			parsed = valueStr.split(",").map(Number);
		} else {
			const num = Number(valueStr);
			parsed = Number.isFinite(num) ? num : valueStr;
		}
		paramOverrides[name] = coerceParameterValue(paramDef, parsed);
	}
}

// Audio overrides (--audio key=value)
const AUDIO_KEYS = ["rms", "peak", "bass", "mid", "treble", "bpm", "beat_phase"] as const;
let audioOverrides: Record<string, number> | undefined;
if (audioRaw.length > 0) {
	audioOverrides = {};
	for (const raw of audioRaw) {
		const eq = raw.indexOf("=");
		if (eq === -1) {
			console.error(`invalid --audio format: "${raw}" (expected key=value)`);
			process.exit(2);
		}
		const key = raw.slice(0, eq);
		const val = Number(raw.slice(eq + 1));
		if (!AUDIO_KEYS.includes(key as any)) {
			console.error(`unknown audio key "${key}". Valid keys: ${AUDIO_KEYS.join(", ")}`);
			process.exit(2);
		}
		if (!Number.isFinite(val)) {
			console.error(`invalid audio value for "${key}": ${raw.slice(eq + 1)}`);
			process.exit(2);
		}
		audioOverrides[key] = val;
	}
}

// ---------------------------------------------------------------------------
// Instantiate WASM runtime if needed
// ---------------------------------------------------------------------------

if (pack.wasmBytes && !pack.wasmRuntime) {
	pack.wasmRuntime = await instantiateWasmPack({
		packId: pack.id,
		bytes: pack.wasmBytes,
		parameterCount: parameterFloatCount(pack.parameters),
	});
}

mkdirSync(pathDirname(outPath), { recursive: true });

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

console.log(`[render-debug] pack: "${pack.name}"`);
console.log(`[render-debug] mode: ${webpMode ? "WebP" : "PNG"}`);
console.log(`[render-debug] resolution: ${width}x${height}, frames: ${frames}`);
if (timeOpt) console.log(`[render-debug] target time: ${timeOpt}s (frame ${frames - 1})`);
if (paramOverrides) console.log(`[render-debug] param overrides: ${JSON.stringify(paramOverrides)}`);
if (audioOverrides) console.log(`[render-debug] audio overrides: ${JSON.stringify(audioOverrides)}`);
if (captureFrames && !webpMode) console.log(`[render-debug] capture frames: ${captureFrames.join(", ")}`);
if (captureTimesS && !webpMode) console.log(`[render-debug] capture times: ${captureTimesS.map((t) => `${t}s`).join(", ")}`);
if (webpMode) {
	const wf = webpFramesOpt ? Number(webpFramesOpt) : 20;
	const wd = webpDurationOpt ? Number(webpDurationOpt) : 100;
	const wq = webpQualityOpt ? Number(webpQualityOpt) : 80;
	console.log(`[render-debug] webp frames: ${wf}, duration: ${wd}ms, quality: ${wq}`);
}
console.log(`[render-debug] output: ${outPath}`);

const t0 = performance.now();

if (webpMode) {
	const webpFrames = webpFramesOpt ? Number(webpFramesOpt) : undefined;
	const webpDuration = webpDurationOpt ? Number(webpDurationOpt) : undefined;
	const webpQuality = webpQualityOpt ? Number(webpQualityOpt) : undefined;
	await renderPackToWebP({
		pack,
		outPath,
		width,
		height,
		frames,
		webpFrames,
		duration: webpDuration,
		quality: webpQuality,
		paramOverrides,
		audioOverrides,
	});
} else {
	await renderPackToPng({
		pack,
		outPath,
		width,
		height,
		frames,
		paramOverrides,
		audioOverrides,
		captureFrames,
		captureTimesS,
	});
}

const ms = Math.round(performance.now() - t0);

console.log(`[render-debug] done in ${ms}ms`);
if (!webpMode) {
	const ext = outPath.match(/(\.[^.]+)$/)?.[1] ?? ".png";
	const base = outPath.slice(0, outPath.length - ext.length);
	if (captureFrames) {
		for (const f of captureFrames) {
			console.log(`[render-debug] captured: ${base}_frame${f}${ext}`);
		}
	}
	if (captureTimesS) {
		for (const t of captureTimesS) {
			const label = t % 1 === 0 ? `${t.toFixed(1)}` : `${t}`;
			console.log(`[render-debug] captured: ${base}_t${label}s${ext}`);
		}
	}
}
console.log(`[render-debug] output: ${outPath}`);

if (pack.wasmRuntime) pack.wasmRuntime.dispose();
process.exit(0);

#!/usr/bin/env bun
// Compare two PNG images and report difference metrics.
//
//   bun scripts/diff-png.ts <a.png> <b.png> [options]
//
// Options:
//   --threshold <n>   Matching threshold 0-1 (perceptual). Lower = more
//                     sensitive. Default 0.1. Set to 0 for exact match.
//   --out <path>      Write a visual diff PNG highlighting changed pixels.
//   --json            Output results as JSON instead of human-readable text.
//   --quiet           Only print the exit code summary line.
//
// Exit codes:
//   0  images are identical (within threshold)
//   1  images differ
//   2  usage error (missing files, dimension mismatch, etc.)
//
// Uses pixelmatch for perceptual comparison with anti-aliasing detection.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

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
	const val = argv[idx + 1];
	argv.splice(idx, 2);
	return val;
}

const jsonMode = flag("--json");
const quiet = flag("--quiet");
const thresholdOpt = option("--threshold");
const outOpt = option("--out");

const threshold = thresholdOpt ? Number(thresholdOpt) : 0.1;
if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
	console.error("--threshold must be 0-1 (perceptual matching threshold)");
	process.exit(2);
}

const fileA = argv.shift();
const fileB = argv.shift();
if (!fileA || !fileB) {
	console.error("usage: bun scripts/diff-png.ts <a.png> <b.png> [options]");
	process.exit(2);
}

const pathA = resolve(fileA);
const pathB = resolve(fileB);

if (!existsSync(pathA)) {
	console.error(`file not found: ${pathA}`);
	process.exit(2);
}
if (!existsSync(pathB)) {
	console.error(`file not found: ${pathB}`);
	process.exit(2);
}

// ---------------------------------------------------------------------------
// Load PNGs
// ---------------------------------------------------------------------------

const imgA = PNG.sync.read(readFileSync(pathA));
const imgB = PNG.sync.read(readFileSync(pathB));

if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
	const msg = `dimension mismatch: ${imgA.width}x${imgA.height} vs ${imgB.width}x${imgB.height}`;
	if (jsonMode) {
		console.log(JSON.stringify({ identical: false, error: msg }));
	} else {
		console.error(`[diff-png] ${msg}`);
	}
	process.exit(2);
}

const { width, height } = imgA;
const totalPixels = width * height;

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

const diffBuf = outOpt ? new Uint8Array(totalPixels * 4) : null;

const changedPixels = pixelmatch(
	imgA.data,
	imgB.data,
	diffBuf,
	width,
	height,
	{ threshold },
);

const identical = changedPixels === 0;
const changedPct = (changedPixels / totalPixels) * 100;

// ---------------------------------------------------------------------------
// Write diff image
// ---------------------------------------------------------------------------

if (outOpt && diffBuf) {
	const diffPng = new PNG({ width, height });
	diffPng.data = Buffer.from(diffBuf);
	writeFileSync(resolve(outOpt), PNG.sync.write(diffPng));
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const result = {
	identical,
	dimensions: `${width}x${height}`,
	totalPixels,
	changedPixels,
	changedPercent: Math.round(changedPct * 100) / 100,
	threshold,
	...(outOpt ? { diffImage: resolve(outOpt) } : {}),
};

if (jsonMode) {
	console.log(JSON.stringify(result));
} else if (!quiet) {
	console.log(`[diff-png] ${pathA}`);
	console.log(`[diff-png] ${pathB}`);
	console.log(`[diff-png] dimensions: ${width}x${height} (${totalPixels} pixels)`);
	console.log(`[diff-png] threshold: ${threshold}`);
	console.log(
		`[diff-png] changed pixels: ${changedPixels} (${changedPct.toFixed(2)}%)`,
	);
	if (outOpt) console.log(`[diff-png] diff image: ${resolve(outOpt)}`);
	console.log(`[diff-png] ${identical ? "IDENTICAL" : "DIFFERENT"}`);
} else {
	console.log(`[diff-png] ${identical ? "IDENTICAL" : "DIFFERENT"}`);
}

process.exit(identical ? 0 : 1);

#!/usr/bin/env bun
// Offline replica of the mandelbulb-slice perturbation pipeline. Mirrors the
// math from `src/packs/mandelbulb-slice/{pack.ts,shader.wgsl}` exactly:
//   - f64 reference orbit at the chosen center
//   - f32-stored Z_n (downcast for the shader)
//   - f32 delta iteration: δ_{n+1} = 2 Z_n δ_n + δ_n² + δc
// For each depth, samples a grid of pixels around the center and reports how
// many escape vs run out of iterations (rendered as interior-black). Lets us
// pinpoint where the precision wall actually lives without bouncing through
// the GPU.
//
// Run: bun run scripts/probe-seahorse.ts

const REF_ITERS = 1024;
const ESCAPE2 = 256.0;
const GRID = 64;            // samples per axis (64×64 = 4096 pixels per depth)
const ASPECT = 16 / 9;       // matches the visualizer
const f = Math.fround;       // round to f32 for delta iteration

type Center = { name: string; cx: number; cy: number };

const CENTERS: Center[] = [
	// Currently-shipped centers
	{ name: "seahorse",     cx: -0.743643887037151, cy:  0.13182590420533 },
	{ name: "misiurewicz",  cx: -0.10109636384562,  cy:  0.95628651080914 },
	{ name: "tante-renate", cx: -1.624324469203164, cy: -9.115253439736786e-8 },
	{ name: "bourke",       cx:  0.42884,            cy: -0.231345 },
	// Sanity-check candidates from published deep-zoom locations.
	{ name: "elephant-valley", cx: 0.2925755,         cy: 0.0149977 },
	{ name: "tante-renate-2",  cx: -0.7746806106269039, cy: -0.1374168856037867 },
	{ name: "bourke-spirals",  cx: -0.761574,         cy: -0.0847596 },
	{ name: "main-cusp-cardioid", cx: -0.25, cy: 0.0 }, // origin of main set; should escape
	{ name: "deep-interior",   cx: -0.15, cy: 0.0 },  // inside main cardioid; everything stays bounded
];

function computeOrbit(cx: number, cy: number): { len: number; orbit: Float32Array } {
	// f64 iteration; downcast each Z_n to f32 for storage (matches the shader's
	// orbit-as-vec4<f32> upload).
	const orbit = new Float32Array(REF_ITERS * 2);
	let zx = 0.0, zy = 0.0;
	for (let k = 0; k < REF_ITERS; k++) {
		orbit[k * 2] = zx;       // implicit f64→f32
		orbit[k * 2 + 1] = zy;
		const nx = zx * zx - zy * zy + cx;
		const ny = 2 * zx * zy + cy;
		zx = nx; zy = ny;
		if (zx * zx + zy * zy > 1e8) return { len: k + 1, orbit };
	}
	return { len: REF_ITERS, orbit };
}

type IterResult = "escape" | "interior";

function iteratePerturb(
	orbit: Float32Array,
	refLen: number,
	dcx: number,
	dcy: number,
): { result: IterResult; iter: number } {
	// Mirrors the shader: at each n, test |Z_n + δ_n|² > 256 first, THEN
	// advance δ via δ_{n+1} = 2 Z_n δ_n + δ_n² + δc. The iterate
	// (Z_n + δ_n) is what escapes — using Z_{n-1} or Z_{n+1} for the test
	// puts it off-by-one and misses real escapes near the wall.
	let dx = f(0), dy = f(0);
	const dcxF = f(dcx), dcyF = f(dcy);
	for (let i = 0; i < refLen; i++) {
		const Zx = orbit[i * 2];
		const Zy = orbit[i * 2 + 1];
		const zx = f(Zx + dx);
		const zy = f(Zy + dy);
		const z2 = f(zx * zx + zy * zy);
		if (z2 > ESCAPE2) return { result: "escape", iter: i };
		const twoZdzX = f(f(2) * f(f(Zx * dx) - f(Zy * dy)));
		const twoZdzY = f(f(2) * f(f(Zx * dy) + f(Zy * dx)));
		const dz2X = f(f(dx * dx) - f(dy * dy));
		const dz2Y = f(f(2) * f(dx * dy));
		dx = f(f(twoZdzX + dz2X) + dcxF);
		dy = f(f(twoZdzY + dz2Y) + dcyF);
	}
	return { result: "interior", iter: refLen };
}

function probe(center: Center, depth: number): {
	escape: number;
	interior: number;
	maxIter: number;
} {
	const { len, orbit } = computeOrbit(center.cx, center.cy);
	const zoom = Math.exp(-depth);
	let escape = 0, interior = 0, maxIter = 0;
	for (let py = 0; py < GRID; py++) {
		for (let px = 0; px < GRID; px++) {
			const u = (px / (GRID - 1)) * 2 - 1;
			const v = (py / (GRID - 1)) * 2 - 1;
			const dcx = u * ASPECT * zoom;
			const dcy = v * zoom;
			const r = iteratePerturb(orbit, len, dcx, dcy);
			if (r.iter > maxIter) maxIter = r.iter;
			if (r.result === "escape") escape++;
			else interior++;
		}
	}
	return { escape, interior, maxIter };
}

const depths = [10, 12, 14, 16, 18, 19, 20, 20.2, 20.5, 21, 22, 23, 24, 25];

for (const c of CENTERS) {
	console.log(`\n=== ${c.name} (${c.cx}, ${c.cy}) ===`);
	const orbit = computeOrbit(c.cx, c.cy);
	console.log(`  reference orbit: ${orbit.len} usable iterations${orbit.len < REF_ITERS ? " (escaped early!)" : ""}`);
	console.log(`  depth |  escape%   interior%  | maxIter`);
	console.log(`  ------+-----------------------+---------`);
	for (const d of depths) {
		const r = probe(c, d);
		const total = r.escape + r.interior;
		console.log(
			`  ${d.toFixed(1).padStart(5)} |  ${(100 * r.escape / total).toFixed(1).padStart(6)}%    ` +
			`${(100 * r.interior / total).toFixed(1).padStart(6)}%   |   ${r.maxIter}`,
		);
	}
}

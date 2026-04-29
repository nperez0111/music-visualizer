// Tier 2 perturbation reference orbit for the Mandelbrot deep-zoom shader.
//
// Why this exists: f32-only escape iteration hits a precision wall at zoom
// depth ~10.2 (per-pixel deltas drop below f32 epsilon). Perturbation theory
// dodges that wall by computing a *single* high-precision orbit at the zoom
// center (in f64 here) and letting the shader iterate cheap f32 deltas
// against it: δ_{n+1} = 2 Z_n δ_n + δ_n² + δc. Adjacent pixels stay
// distinguishable because the delta is what's tracked per-pixel, not the
// absolute coordinate.
//
// Pipeline:
//   1. CPU side (here): compute Z_n in f64 starting from the shot's center.
//      Recompute only when the center changes (shot boundary or `pick` enum
//      change) — every other frame is pure cache hit.
//   2. Downcast each Z_n to f32 and pack into the pack-uniform region as
//      pairs-per-vec4 (densest representation that the shader can index).
//   3. Shader does the perturbation iteration against the orbit.
//
// f32 storage of Z_n is fine for our depth budget because |Z_n| stays
// bounded around 1 for boundary points — full f32 precision applies. The
// precision wall moves out from depth 10 to ~depth 30; pushing further
// would need DS/DD storage of the orbit (and CPU bignum to compute it).

// 1024 iterations is enough to resolve boundary detail at depth ~25 for the
// chosen centers. Below ~600 you start getting black-out at deep dwell because
// pixels that haven't escaped get classified as interior even though they're
// really near-boundary points that just need more iterations.
const REF_ITERS: i32 = 1024;

// Output buffer layout (must match shader.wgsl's Uniforms.{refHeader,orbit}):
//   header (vec4): [refIters, _pad, _pad, _pad]
//   orbit  (array<vec4, REF_ITERS/2>): each vec4 packs two complex points
//     as (x_k, y_k, x_{k+1}, y_{k+1}).
const HEADER_BYTES: i32 = 16;
const ORBIT_BYTES: i32 = REF_ITERS * 8;             // 2 f32 per point
const TOTAL_BYTES: i32 = HEADER_BYTES + ORBIT_BYTES; // 2576

// Sentinel: |z|² > BAILOUT means the reference itself escaped; the orbit
// past that index is meaningless and the shader should stop iterating.
const REF_BAILOUT: f64 = 1e8;

const SHOT_S: f64 = 120.0;

let outputPtr: i32 = 0;

// Cached state — orbit is recomputed only when these change.
let cachedKey: i32 = -1;          // shotIdx (cycle mode) or -targetMode (fixed mode)
let cachedRefIters: i32 = 0;

// Reference orbit in f64 (intermediate; downcast to f32 for upload).
let refX: StaticArray<f64> = new StaticArray<f64>(REF_ITERS);
let refY: StaticArray<f64> = new StaticArray<f64>(REF_ITERS);

export function viz_pack_uniform_size(): u32 {
	return <u32>TOTAL_BYTES;
}

export function viz_init(_featureCount: u32, _parameterCount: u32): u32 {
	const out = new StaticArray<u8>(TOTAL_BYTES);
	outputPtr = changetype<i32>(out);
	cachedKey = -1;
	cachedRefIters = 0;
	return 1;
}

export function viz_frame(
	_handle: u32,
	timeMs: f32,
	_featuresPtr: u32,
	paramsPtr: u32,
): u32 {
	// Manifest params (each occupies one 16-byte vec4 slot, .x at offset 0):
	//   slot 0: speed (float)
	//   slot 1: pick  (enum index — 0=cycle, 1=seahorse, 2=misiurewicz, 3=tante-renate, 4=bourke)
	//   slot 2: tint  (color, unused here — shader handles)
	//   slot 3: bassDepth (float, unused here — shader handles)
	const speed: f32 = load<f32>(paramsPtr + 0);
	const pickF: f32 = load<f32>(paramsPtr + 16);
	const targetMode: i32 = <i32>(pickF + <f32>0.5);

	const t: f64 = <f64>timeMs * 0.001 * <f64>speed;
	let shotIdxRaw: i32 = <i32>(t / SHOT_S);
	if (shotIdxRaw < 0) shotIdxRaw = 0;

	// Pick the center. Mirrors shader logic exactly so reference and display
	// agree on which boundary point we're zooming toward.
	let idx: i32;
	if (targetMode == 0) {
		idx = shotIdxRaw % 4;
	} else {
		idx = targetMode - 1;
		if (idx < 0) idx = 0;
		if (idx > 3) idx = 3;
	}

	// Coordinates verified against published deep-zoom sources (Wikipedia /
	// Wolfgang Beyer, Paul Bourke, Tante Renate). Truncating these even at
	// the 8th decimal places the center inside one of seahorse valley's
	// microscopic periodic bulbs → orbit converges → all-black render.
	let cx: f64 = -0.743643887037151;   // Seahorse Valley satellite minibrot
	let cy: f64 =  0.13182590420533;
	if (idx == 1) {
		cx = -0.10109636384562;          // Misiurewicz M_3,1
		cy =  0.95628651080914;
	} else if (idx == 2) {
		cx = -1.624324469203164;         // Tante Renate
		cy = -9.115253439736786e-8;
	} else if (idx == 3) {
		cx =  0.42884;                   // Paul Bourke right-boundary
		cy = -0.231345;
	}

	// Cache key: shotIdx in cycle mode, fixed-mode synthetic key otherwise.
	// Disjoint spaces so cycle-mode shotIdx 1 doesn't collide with target=1.
	const key: i32 = targetMode == 0 ? shotIdxRaw : -(targetMode);
	if (key != cachedKey) {
		cachedKey = key;
		cachedRefIters = computeOrbit(cx, cy);
	}

	// Header: refIters as f32 + 3 pad floats.
	store<f32>(outputPtr + 0, <f32>cachedRefIters);
	store<f32>(outputPtr + 4, <f32>0.0);
	store<f32>(outputPtr + 8, <f32>0.0);
	store<f32>(outputPtr + 12, <f32>0.0);

	// Orbit: pack (x_k, y_k) at offset HEADER + k*8.
	for (let k: i32 = 0; k < REF_ITERS; k++) {
		const off = HEADER_BYTES + k * 8;
		store<f32>(outputPtr + off + 0, <f32>refX[k]);
		store<f32>(outputPtr + off + 4, <f32>refY[k]);
	}

	return <u32>outputPtr;
}

function computeOrbit(cx: f64, cy: f64): i32 {
	// Standard escape iteration in f64. Records every Z_n; if the reference
	// escapes early (which shouldn't happen for our chosen boundary points
	// but might if the user picks a degenerate `pick` value), returns the
	// length so the shader doesn't read past the live region.
	let zx: f64 = 0.0;
	let zy: f64 = 0.0;
	for (let k: i32 = 0; k < REF_ITERS; k++) {
		refX[k] = zx;
		refY[k] = zy;
		const newX: f64 = zx * zx - zy * zy + cx;
		const newY: f64 = 2.0 * zx * zy + cy;
		zx = newX;
		zy = newY;
		if (zx * zx + zy * zy > REF_BAILOUT) {
			return k + 1;
		}
	}
	return REF_ITERS;
}

export function viz_dispose(_handle: u32): void {}

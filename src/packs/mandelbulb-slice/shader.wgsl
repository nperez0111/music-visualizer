// Mandelbrot deep-zoom via perturbation theory. The pack's WASM side
// (pack.ts) computes a high-precision (f64) reference orbit at the shot's
// center and uploads it as `Uniforms.orbit`. Each pixel iterates a delta
// against that reference in f32 — adjacent pixels stay distinguishable
// because the *delta* is what's tracked, not the absolute coordinate. Lifts
// the precision wall from depth ~10 (naive f32) to ~depth 30.

struct Uniforms {
  time_ms     : f32,
  delta_ms    : f32,
  resolution  : vec2<f32>,
  rms         : f32,
  peak        : f32,
  bass        : f32,
  mid         : f32,
  treble      : f32,
  bpm         : f32,
  beat_phase  : f32,
  _pad        : f32,
  spectrum    : array<vec4<f32>, 8>,
  // --- Pack-defined region (matches pack.ts layout) ---
  refHeader   : vec4<f32>,             // .x = number of usable orbit entries
  // Up to 1024 complex points, 2 per vec4 (x_k,y_k,x_{k+1},y_{k+1}).
  orbit       : array<vec4<f32>, 512>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

// One vec4 slot per manifest entry, in declaration order.
struct Params {
  speed     : vec4<f32>, // x = speed multiplier
  pick      : vec4<f32>, // x = enum index. NOTE: WGSL field is `pick`; `target` is a naga reserved word.
  tint      : vec4<f32>, // xyz = palette tint
  bassDepth : vec4<f32>, // x = bass depth modulation
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

// Center cycle period (cycle mode): every SHOT_S seconds the active boundary
// point rotates through the 4 targets. Independent of zoom cycle.
const SHOT_S : f32 = 120.0;
// Zoom cycle period: depth ramps from 3.5 → max over ZOOM_S, then snaps back
// and starts again. SHOT_S must be an integer multiple of ZOOM_S so center
// transitions and zoom resets coincide and share the cutFade.
const ZOOM_S : f32 = 30.0;
const ESCAPE2 : f32 = 256.0;

fn palette(t: f32) -> vec3<f32> {
  return 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * t + vec3<f32>(0.0, 0.45, 0.75)));
}

// Read Z_k from the packed orbit (two complex points per vec4).
fn orbitAt(k: i32) -> vec2<f32> {
  let v = u.orbit[k >> 1];
  if ((k & 1) == 0) {
    return v.xy;
  }
  return v.zw;
}

// 7-segment digit. `local` is in [0,1]² inside one digit cell, y top-down.
// Returns 1.0 if the pixel sits on a lit segment for `digit`, 0.0 otherwise.
// Segment bitmask layout (LSB→MSB): a top, b upper-right, c lower-right,
// d bottom, e lower-left, f upper-left, g middle.
fn drawDigit(local: vec2<f32>, digit: u32) -> f32 {
  var masks = array<u32, 10>(63u, 6u, 91u, 79u, 102u, 109u, 125u, 7u, 127u, 111u);
  let m = masks[digit];
  let x = local.x;
  let y = local.y;
  let segA = step(0.10, x) * step(x, 0.90) * step(0.05, y) * step(y, 0.15);
  let segB = step(0.83, x) * step(x, 0.95) * step(0.10, y) * step(y, 0.48);
  let segC = step(0.83, x) * step(x, 0.95) * step(0.52, y) * step(y, 0.90);
  let segD = step(0.10, x) * step(x, 0.90) * step(0.85, y) * step(y, 0.95);
  let segE = step(0.05, x) * step(x, 0.17) * step(0.52, y) * step(y, 0.90);
  let segF = step(0.05, x) * step(x, 0.17) * step(0.10, y) * step(y, 0.48);
  let segG = step(0.10, x) * step(x, 0.90) * step(0.46, y) * step(y, 0.54);
  let lit =
    segA * f32((m >>  0u) & 1u) +
    segB * f32((m >>  1u) & 1u) +
    segC * f32((m >>  2u) & 1u) +
    segD * f32((m >>  3u) & 1u) +
    segE * f32((m >>  4u) & 1u) +
    segF * f32((m >>  5u) & 1u) +
    segG * f32((m >>  6u) & 1u);
  return clamp(lit, 0.0, 1.0);
}

// Decimal point: small filled square near bottom-center.
fn drawDot(local: vec2<f32>) -> f32 {
  return step(0.40, local.x) * step(local.x, 0.55)
       * step(0.83, local.y) * step(local.y, 0.95);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001 * p.speed.x;

  let targetMode = u32(p.pick.x + 0.5);

  // Zoom cycle (sawtooth): ramps 0 → 1 over ZOOM_S, then snaps back. Each
  // wrap is a full reset to depth=3.5, so the visual is "zoom in, reset, zoom
  // in" continuously. The cutFade below blacks out the snap so it doesn't
  // strobe.
  let zoomCycle = fract(t / ZOOM_S);
  let depthCurve = pow(zoomCycle, 0.6);
  // Max depth raised from the f32-naive 10.2 to 25 — perturbation buys ~15
  // more digits via the f64 reference orbit. f32 delta arithmetic stays clean
  // here; pushing past 28 starts showing per-pixel wear without DS storage.
  let depth = mix(3.5, 25.0, depthCurve) + u.bass * p.bassDepth.x;
  let zoom = exp(-depth);
  // Per-pixel offset from the reference center. With perturbation, |dc| can
  // be many orders of magnitude smaller than the absolute c — adjacent
  // pixels still differ by f32 ULPs because they're tracked relative to
  // the same Z_n.
  let dc = uv * zoom;

  let refIters = i32(u.refHeader.x);

  // Perturbation iteration. Order matters:
  //   1. Read Z_n; iterate is z_n = Z_n + δ_n.
  //   2. Test |z_n|² > 256.
  //   3. Advance δ_{n+1} = 2 Z_n δ_n + δ_n² + δc.
  // Doing the update before the test pairs Z_n with δ_{n+1}, off-by-one. That
  // misses real escapes near the precision wall and leaks otherwise-coloured
  // pixels into "interior" (black). Confirmed empirically — see
  // scripts/probe-seahorse.ts.
  var dz = vec2<f32>(0.0, 0.0);
  var i: i32 = 0;
  var lastZ2: f32 = 0.0;
  var escaped: bool = false;
  loop {
    if (i >= refIters) { break; }
    let Z = orbitAt(i);
    let z = Z + dz;
    lastZ2 = dot(z, z);
    if (lastZ2 > ESCAPE2) {
      escaped = true;
      break;
    }
    let twoZdz = vec2<f32>(
      2.0 * (Z.x * dz.x - Z.y * dz.y),
      2.0 * (Z.x * dz.y + Z.y * dz.x),
    );
    let dz2 = vec2<f32>(
      dz.x * dz.x - dz.y * dz.y,
      2.0 * dz.x * dz.y,
    );
    dz = twoZdz + dz2 + dc;
    i = i + 1;
  }

  var color = vec3<f32>(0.0, 0.0, 0.0);
  if (escaped) {
    // Continuous escape-time coloring (smooth iteration count).
    let nu = log2(log2(lastZ2) * 0.5);
    let smoothI = f32(i) + 1.0 - nu;
    let phase = smoothI * 0.022 + u.mid * 0.35 + t * 0.04;
    color = palette(phase);
    // Treble sparkle on the high-iteration edge band.
    let edge = smoothstep(40.0, 0.0, f32(refIters - i));
    color = color + vec3<f32>(u.treble * 0.35) * edge;
  }

  // Apply user tint.
  color = mix(color, color * p.tint.xyz, 0.5);

  // Fade at zoom-cycle boundaries so the depth snap-back doesn't strobe.
  // Because SHOT_S is a multiple of ZOOM_S, this also covers the (rarer)
  // center swap in cycle mode — center transitions only happen at zoomCycle≈0.
  let cutFade = smoothstep(0.0, 0.04, zoomCycle) * (1.0 - smoothstep(0.96, 1.0, zoomCycle));
  color = color * cutFade;

  // Beat sparkle.
  let pulse = pow(1.0 - u.beat_phase, 14.0) * (0.25 + u.peak * 0.5);
  color = color + vec3<f32>(pulse * 0.12);

  // Depth HUD: 4 chars ("DD.D") in the bottom-left, lit yellow over a dim
  // backing rectangle. Lets you see the perturbation actually pushing past
  // the old f32 wall (~10) into the 20s.
  let HUD_PAD : f32 = 8.0;
  let HUD_W   : f32 = 96.0;
  let HUD_H   : f32 = 32.0;
  let hudX = HUD_PAD;
  let hudY = u.resolution.y - HUD_PAD - HUD_H;
  let pixc = frag_pos.xy;
  if (pixc.x >= hudX && pixc.x < hudX + HUD_W &&
      pixc.y >= hudY && pixc.y < hudY + HUD_H) {
    color = mix(color, vec3<f32>(0.0), 0.65);
    let cellW = HUD_W * 0.25;
    let cellIdx = i32((pixc.x - hudX) / cellW);
    let local = vec2<f32>(
      (pixc.x - hudX - f32(cellIdx) * cellW) / cellW,
      (pixc.y - hudY) / HUD_H,
    );
    // Format depth as DD.D — works for 0.0 to 99.9.
    let scaled = i32(depth * 10.0 + 0.5);
    let dTens   = u32((scaled / 100) % 10);
    let dOnes   = u32((scaled /  10) % 10);
    let dTenths = u32(scaled % 10);
    var lit: f32 = 0.0;
    if (cellIdx == 0) { lit = drawDigit(local, dTens); }
    else if (cellIdx == 1) { lit = drawDigit(local, dOnes); }
    else if (cellIdx == 2) { lit = drawDot(local); }
    else if (cellIdx == 3) { lit = drawDigit(local, dTenths); }
    color = mix(color, vec3<f32>(1.0, 0.95, 0.55), lit);
  }

  return vec4<f32>(color, 1.0);
}

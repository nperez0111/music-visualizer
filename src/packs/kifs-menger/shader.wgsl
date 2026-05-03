// 3D Menger-sponge KIFS, ray-marched.
// Each fold step: abs() into the +octant, sort axes (Sierpinski-like),
// then scale-and-translate about an offset. Inserting a small rotation
// between folds turns the static sponge into a musical, breathing lattice.

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
};

@group(0) @binding(0) var<uniform> u: Uniforms;

struct Params {
  speed      : vec4<f32>, // x = speed multiplier
  rotation   : vec4<f32>, // x = base fold twist (radians)
  iterations : vec4<f32>, // x = iteration count
  tint       : vec4<f32>, // xyz = surface tint
};
@group(1) @binding(0) var<uniform> p: Params;

const RAY_STEPS : i32 = 96;
const MIN_DIST  : f32 = 0.0012;
const MAX_DIST  : f32 = 60.0;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn rotY(p: vec3<f32>, a: f32) -> vec3<f32> {
  let s = sin(a); let c = cos(a);
  return vec3<f32>(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

fn rotX(p: vec3<f32>, a: f32) -> vec3<f32> {
  let s = sin(a); let c = cos(a);
  return vec3<f32>(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
}

// SDF for a unit cube (axis-aligned, half-extent 1).
fn sdBox(p: vec3<f32>, b: vec3<f32>) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Menger-style KIFS: abs + axis sort + scale-translate, with a small
// rotation injected each iteration so the lattice swirls instead of
// sitting static. `twist` is mostly mid-band driven; the user dials in
// a baseline.
fn mengerDE(p_in: vec3<f32>, iters: u32, twist: f32) -> f32 {
  var p = p_in;
  let scale: f32 = 3.0;
  let offset = vec3<f32>(1.0, 1.0, 1.0);

  for (var i: u32 = 0u; i < iters; i = i + 1u) {
    // Inter-fold rotation (the K in KIFS) — alternating axes keeps it lively.
    if ((i & 1u) == 0u) {
      p = rotY(p, twist * 0.7);
    } else {
      p = rotX(p, twist * 0.5);
    }

    p = abs(p);
    // Sort axes so the fold collapses into the dominant octant.
    if (p.x < p.y) { p = vec3<f32>(p.y, p.x, p.z); }
    if (p.x < p.z) { p = vec3<f32>(p.z, p.y, p.x); }
    if (p.y < p.z) { p = vec3<f32>(p.x, p.z, p.y); }

    p.z = p.z - 0.5 * offset.z * (scale - 1.0);
    p.z = -abs(p.z);
    p.z = p.z + 0.5 * offset.z * (scale - 1.0);

    p = p * scale - offset * (scale - 1.0);
  }

  // De-scale a bounding cube back into world space.
  let scaleN = pow(scale, -f32(iters));
  return sdBox(p, vec3<f32>(1.5)) * scaleN;
}

fn calcNormal(pos: vec3<f32>, iters: u32, twist: f32) -> vec3<f32> {
  let e = vec2<f32>(0.0015, 0.0);
  let n = vec3<f32>(
    mengerDE(pos + e.xyy, iters, twist) - mengerDE(pos - e.xyy, iters, twist),
    mengerDE(pos + e.yxy, iters, twist) - mengerDE(pos - e.yxy, iters, twist),
    mengerDE(pos + e.yyx, iters, twist) - mengerDE(pos - e.yyx, iters, twist),
  );
  return normalize(n);
}

fn palette(t: f32) -> vec3<f32> {
  return 0.5 + 0.5 * cos(6.2831 * (vec3<f32>(1.0) * t + vec3<f32>(0.0, 0.33, 0.67)));
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, -1.0);
  let t = u.time_ms * 0.001 * p.speed.x;

  let beat = pow(1.0 - u.beat_phase, 6.0);

  // Mid drives the fold twist around the user's baseline. Beat snaps it.
  let twist = clamp(p.rotation.x + (u.mid - 0.4) * 0.6 + beat * 0.25, 0.0, 1.6);

  let iters = u32(clamp(p.iterations.x, 3.0, 8.0));

  // Camera orbit; bass pushes it inward so the structure looms on a kick.
  let camR = 4.0 - 0.8 * u.bass;
  let camA = t * 0.20;
  let camB = 0.55 * sin(t * 0.13);
  let ro = vec3<f32>(cos(camA) * camR, camB, sin(camA) * camR);
  let fwd = normalize(vec3<f32>(0.0) - ro);
  let right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, right);
  let rd = normalize(fwd + uv.x * right + uv.y * up);

  var d: f32 = 0.0;
  var hit: f32 = 0.0;
  var steps: i32 = RAY_STEPS;
  for (var i: i32 = 0; i < RAY_STEPS; i = i + 1) {
    let pos = ro + rd * d;
    let h = mengerDE(pos, iters, twist);
    d = d + h;
    if (h < MIN_DIST) { hit = 1.0; steps = i; break; }
    if (d > MAX_DIST) { steps = i; break; }
    steps = i;
  }

  // Background gradient.
  let bg = mix(vec3<f32>(0.02, 0.025, 0.04), vec3<f32>(0.06, 0.05, 0.10), pix.y);
  var color = bg;

  if (hit > 0.5) {
    let pos_hit = ro + rd * d;
    let n = calcNormal(pos_hit, iters, twist);

    let keyDir  = normalize(vec3<f32>(0.6, 0.8, -0.3));
    let fillDir = normalize(vec3<f32>(-0.4, -0.1, 0.7));
    let keyL  = max(dot(n, keyDir), 0.0);
    let fillL = max(dot(n, fillDir), 0.0);

    // Step-count AO: deeper crevices used more steps -> darker.
    let ao = pow(1.0 - f32(steps) / f32(RAY_STEPS), 1.5);

    let tintPhase = t * 0.04 + u.mid * 0.3 + n.x * 0.12 + n.y * 0.08;
    let tint = palette(tintPhase) * p.tint.xyz;
    let coolFill = vec3<f32>(0.30, 0.40, 0.60);

    let view = -rd;
    let halfV = normalize(keyDir + view);
    let spec  = pow(max(dot(n, halfV), 0.0), 32.0);
    let rim   = pow(1.0 - max(dot(n, view), 0.0), 3.0);

    var shaded = tint * (0.18 + 0.9 * keyL) + coolFill * (0.32 * fillL);
    shaded = shaded * (0.4 + 0.6 * ao);
    shaded = shaded + vec3<f32>(spec) * (0.45 + u.treble * 0.6);
    shaded = shaded + tint * rim * 0.35;

    let fog = 1.0 - exp(-d * 0.10);
    color = mix(shaded, bg, fog);
  }

  // Beat punch — kept subtle so the lattice stays readable.
  color = color + vec3<f32>(beat * (0.15 + u.peak * 0.35) * 0.10);

  let v = smoothstep(1.7, 0.5, length(uv));
  color = color * (0.45 + 0.55 * v);

  return vec4<f32>(color, 1.0);
}

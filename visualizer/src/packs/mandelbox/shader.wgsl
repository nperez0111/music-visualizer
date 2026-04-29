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

// Pack-declared parameters. One vec4 slot per manifest entry, in order.
struct Params {
  speed     : vec4<f32>, // x = speed multiplier
  foldScale : vec4<f32>, // x = base mandelbox fold scale
  tint      : vec4<f32>, // xyz = surface tint
  bassFold  : vec4<f32>, // x = bass fold modulation
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

const FOLD_ITERS : i32 = 8;
const RAY_STEPS  : i32 = 56;
const MIN_DIST   : f32 = 0.0015;
const MAX_DIST   : f32 = 50.0;

fn boxFold(p: vec3<f32>) -> vec3<f32> {
  return clamp(p, vec3<f32>(-1.0, -1.0, -1.0), vec3<f32>(1.0, 1.0, 1.0)) * 2.0 - p;
}

fn mandelboxDE(p_in: vec3<f32>, scale: f32) -> f32 {
  var p = p_in;
  var dz: f32 = 1.0;
  for (var i: i32 = 0; i < FOLD_ITERS; i = i + 1) {
    p = boxFold(p);
    let r2 = dot(p, p);
    if (r2 < 0.5) {
      let f = 1.0 / 0.5;
      p = p * f; dz = dz * f;
    } else if (r2 < 1.0) {
      let f = 1.0 / r2;
      p = p * f; dz = dz * f;
    }
    p = p * scale + p_in;
    dz = dz * abs(scale) + 1.0;
  }
  return length(p) / abs(dz);
}

fn palette(t: f32) -> vec3<f32> {
  return 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * t + vec3<f32>(0.0, 0.4, 0.7)));
}

// Numerical surface normal via 4-tap forward differences.
fn mandelboxNormal(p: vec3<f32>, scale: f32) -> vec3<f32> {
  let e = vec2<f32>(0.0015, 0.0);
  let n = vec3<f32>(
    mandelboxDE(p + e.xyy, scale) - mandelboxDE(p - e.xyy, scale),
    mandelboxDE(p + e.yxy, scale) - mandelboxDE(p - e.yxy, scale),
    mandelboxDE(p + e.yyx, scale) - mandelboxDE(p - e.yyx, scale),
  );
  return normalize(n);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, -1.0);
  let t = u.time_ms * 0.00009 * p.speed.x;

  // Bass and treble nudge the fold scale a little; the slow sine drift dominates.
  let scale = p.foldScale.x + 0.35 * sin(t * 0.5) + u.bass * p.bassFold.x + (u.treble - 0.5) * 0.05;

  // Slow camera orbit; gentler vertical bob.
  let camR = 4.6;
  let camAngle = t * 0.18;
  let cx = cos(camAngle);
  let cz = sin(camAngle);
  let ro = vec3<f32>(cx * camR, 0.9 * sin(t * 0.13), cz * camR);
  let fwd = normalize(vec3<f32>(0.0, 0.0, 0.0) - ro);
  let right = normalize(cross(vec3<f32>(0.0, 1.0, 0.0), fwd));
  let up = cross(fwd, right);
  let rd = normalize(fwd + uv.x * right + uv.y * up);

  var d: f32 = 0.0;
  var stepCount: i32 = RAY_STEPS;
  var hit: f32 = 0.0;
  for (var i: i32 = 0; i < RAY_STEPS; i = i + 1) {
    let p = ro + rd * d;
    let h = mandelboxDE(p, scale);
    d = d + h;
    if (h < MIN_DIST) { hit = 1.0; stepCount = i; break; }
    if (d > MAX_DIST) { stepCount = i; break; }
    stepCount = i;
  }

  // Background: dim warm-cool gradient so misses aren't pure black.
  let bg = mix(vec3<f32>(0.02, 0.025, 0.05), vec3<f32>(0.05, 0.04, 0.08), pix.y);
  var color = bg;

  if (hit > 0.5) {
    let p_hit = ro + rd * d;
    let n = mandelboxNormal(p_hit, scale);

    // Two-light setup: a key from upper-front, a cool fill from below-behind.
    let keyDir  = normalize(vec3<f32>(0.6, 0.7, -0.4));
    let fillDir = normalize(vec3<f32>(-0.3, -0.2, 0.6));
    let keyL  = max(dot(n, keyDir), 0.0);
    let fillL = max(dot(n, fillDir), 0.0);

    // Cheap ambient occlusion from steps consumed (more steps = creased fold).
    let ao = pow(1.0 - f32(stepCount) / f32(RAY_STEPS), 1.5);

    // Surface tint cycles slowly with mid energy; stays distinct per fold via the normal.
    let tintPhase = t * 0.05 + u.mid * 0.3 + n.x * 0.15 + n.y * 0.1;
    let tint = palette(tintPhase) * p.tint.xyz;
    let coolFill = vec3<f32>(0.25, 0.35, 0.55);

    // Diffuse + fill + rim + a subtle specular for crisp fold highlights.
    let view = -rd;
    let halfV = normalize(keyDir + view);
    let spec  = pow(max(dot(n, halfV), 0.0), 28.0);
    let rim   = pow(1.0 - max(dot(n, view), 0.0), 3.0);

    var shaded = tint * (0.18 + 0.85 * keyL) + coolFill * (0.35 * fillL);
    shaded = shaded * (0.4 + 0.6 * ao);
    shaded = shaded + vec3<f32>(spec) * 0.45;
    shaded = shaded + tint * rim * 0.35;

    // Distance fog so far folds recede instead of competing with near ones.
    let fog = 1.0 - exp(-d * 0.08);
    color = mix(shaded, bg, fog);
  }

  // Beat punch (subtle so the structure stays readable).
  let pulse = pow(1.0 - u.beat_phase, 14.0) * (0.15 + u.peak * 0.35);
  color = color + vec3<f32>(pulse * 0.10);

  // Vignette
  let v = smoothstep(1.7, 0.5, length(uv));
  color = color * (0.45 + 0.55 * v);

  return vec4<f32>(color, 1.0);
}

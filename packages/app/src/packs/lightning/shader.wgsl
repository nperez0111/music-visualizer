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
  bolts     : vec4<f32>, // x = bolts per strike (1..6)
  boltColor : vec4<f32>, // xyz = bolt color
  flashAmt  : vec4<f32>, // x = sky flash intensity
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash(i);
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

fn fbm(p: vec2<f32>) -> f32 {
  var v: f32 = 0.0;
  var amp: f32 = 0.5;
  var q: vec2<f32> = p;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    v = v + amp * vnoise(q);
    q = q * 2.0;
    amp = amp * 0.5;
  }
  return v;
}

// One bolt: warped vertical line. seed picks branch geometry.
fn bolt(uv: vec2<f32>, seed: f32, t: f32, wobble: f32) -> f32 {
  // Animate noise field along the bolt; warp x from y.
  let xCenter = (seed - 0.5) * 1.6;
  let q = vec2<f32>(uv.y * 2.0 + seed * 13.0, t * 6.0 + seed * 7.0);
  let warp = (fbm(q) - 0.5) * (0.30 + wobble * 0.6);
  let dx = uv.x - (xCenter + warp);

  // Core line + halo.
  let core = exp(-abs(dx) * 220.0);
  let halo = exp(-abs(dx) * 22.0) * 0.45;

  // Branches: cosine-modulated extra strikes.
  let branch = exp(-abs(dx + sin(uv.y * 12.0 + seed * 31.0) * 0.18) * 80.0) * 0.35;

  return core + halo + branch;
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv  = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001;

  // Stormy dark blue background.
  let bg = mix(vec3<f32>(0.02, 0.02, 0.05), vec3<f32>(0.05, 0.04, 0.10), pix.y);
  var color = bg;

  // Beat envelope: 1 at strike, decays over the bar.
  let strike = pow(1.0 - u.beat_phase, 3.0);

  // Spawn N bolts per strike with seeds drawn from the time bucket.
  // bpm is uniforms-provided; fall back to 120 if absent.
  let bps = max(u.bpm, 60.0) / 60.0;
  let beatIndex = floor(u.time_ms * 0.001 * bps);
  let nBolts = i32(clamp(p.bolts.x, 1.0, 6.0));
  for (var i: i32 = 0; i < nBolts; i = i + 1) {
    let seed = hash(vec2<f32>(beatIndex, f32(i) * 17.0));
    let intensity = bolt(uv, seed, t, u.treble);
    let amp = strike * (0.7 + u.bass * 0.5) * (0.5 + 0.5 * hash(vec2<f32>(beatIndex, f32(i))));
    color = color + p.boltColor.xyz * intensity * amp;
  }

  // Sky flash: full-screen flicker scaled by RMS at strike.
  let flash = strike * (0.2 + u.peak * 0.4) * (0.4 + 0.6 * fbm(uv * 2.0 + vec2<f32>(0.0, t * 6.0)));
  color = color + p.boltColor.xyz * flash * p.flashAmt.x;

  // Distant low rumble — dark clouds shifting.
  let clouds = fbm(uv * 1.4 + vec2<f32>(t * 0.05, t * 0.02));
  color = color + vec3<f32>(0.05, 0.05, 0.10) * clouds * 0.6;

  return vec4<f32>(color, 1.0);
}

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
  paletteShift : vec4<f32>, // x = static palette offset (0..1)
  warpAmount   : vec4<f32>, // x = domain warp intensity multiplier
  glitter      : vec4<f32>, // x > 0.5 enables treble glitter
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
    q = q * 2.02 + vec2<f32>(0.13, 0.71);
    amp = amp * 0.5;
  }
  return v;
}

fn palette(t: f32) -> vec3<f32> {
  return 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * t + vec3<f32>(0.00, 0.20, 0.55)));
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv  = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001;

  // Rotate uv slowly with bass for a swirling frame.
  let ang = t * 0.05 + u.bass * 0.6;
  let ca = cos(ang);
  let sa = sin(ang);
  let p0 = vec2<f32>(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);

  // Domain warp twice — Inigo-Quilez style — for "fluid" structure.
  let q = vec2<f32>(
    fbm(p0 * 1.4 + vec2<f32>(t * 0.20, 0.0)),
    fbm(p0 * 1.4 + vec2<f32>(5.2, t * 0.17))
  );

  let warpK = p.warpAmount.x * 4.0;
  let r = vec2<f32>(
    fbm(p0 * 1.6 + warpK * q + vec2<f32>(1.7, 9.2) + t * 0.15),
    fbm(p0 * 1.6 + warpK * q + vec2<f32>(8.3, 2.8) + t * 0.13)
  );

  let v = fbm(p0 * 2.2 + warpK * r + vec2<f32>(0.0, t * 0.10));

  // Swirl-shaped streaks: turn fbm into a flow visualization.
  let stream = sin((q.x - q.y) * 12.0 + (r.x + r.y) * 6.0 + t * 1.2 + u.bass * 4.0);
  let streamMask = 0.5 + 0.5 * stream;

  var color = palette(v + t * 0.05 + u.mid * 0.3 + p.paletteShift.x);

  // Use streams to modulate brightness so it reads as moving currents.
  color = color * (0.45 + 0.7 * streamMask);

  // Treble glitter — high-frequency speckle on the surface.
  let glitter = step(0.985, hash(floor(uv * (300.0 + u.treble * 200.0)) + floor(t * 30.0)));
  color = color + vec3<f32>(glitter) * u.treble * 0.6 * step(0.5, p.glitter.x);

  // Beat punch — global brightness lift that decays.
  let pulse = pow(1.0 - u.beat_phase, 10.0) * (0.30 + u.peak * 0.5);
  color = color + vec3<f32>(pulse * 0.20);

  return vec4<f32>(color, 1.0);
}

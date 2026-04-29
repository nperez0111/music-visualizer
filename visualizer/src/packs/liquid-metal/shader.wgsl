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

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn hash21(p: vec2<f32>) -> f32 {
  let q = vec2<f32>(dot(p, vec2<f32>(127.1, 311.7)), dot(p, vec2<f32>(269.5, 183.3)));
  return fract(sin(q.x + q.y) * 43758.5453);
}

fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  let s = f * f * (vec2<f32>(3.0, 3.0) - 2.0 * f);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

fn fbm(p_in: vec2<f32>) -> f32 {
  var p = p_in;
  var v: f32 = 0.0;
  var a: f32 = 0.5;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    v = v + a * vnoise(p);
    p = p * 2.04 + vec2<f32>(1.7, -0.3);
    a = a * 0.5;
  }
  return v;
}

fn surface(uv: vec2<f32>, t: f32, warpAmp: f32) -> f32 {
  let drift = vec2<f32>(t, t * 0.7);
  let warp = vec2<f32>(
    fbm(uv * 1.4 + drift),
    fbm(uv * 1.4 + drift + vec2<f32>(5.2, 1.3)),
  );
  return fbm(uv * 1.7 + warp * warpAmp + drift);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.0005;

  let warpAmp = 1.4 + u.bass * 1.6;
  let h  = surface(uv, t, warpAmp);
  let hx = surface(uv + vec2<f32>(0.006, 0.0), t, warpAmp);
  let hy = surface(uv + vec2<f32>(0.0, 0.006), t, warpAmp);
  let n = normalize(vec3<f32>((hx - h) * 6.0, (hy - h) * 6.0, 0.4));

  // Moving point-light + audio jitter on direction.
  let lightDir = normalize(vec3<f32>(0.55 * sin(t * 0.5), 0.7, 1.0));
  let diff = max(dot(n, lightDir), 0.0);
  let spec = pow(diff, 22.0 + u.treble * 28.0);

  // Cycling tint with mid energy.
  let tintPhase = h * 0.6 + t * 0.18 + u.mid * 0.45;
  let tint = 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * tintPhase + vec3<f32>(0.05, 0.55, 0.95)));

  // Fake fresnel using how much the normal points away from camera (z).
  let fres = pow(1.0 - n.z, 3.0);

  var color = tint * (0.22 + 0.55 * h) + vec3<f32>(spec) * (0.7 + u.peak * 0.4);
  color = color + tint * fres * 0.35;

  // Beat punch
  let pulse = pow(1.0 - u.beat_phase, 12.0) * (0.25 + u.peak * 0.55);
  color = color + tint * pulse * 0.15;

  return vec4<f32>(color, 1.0);
}

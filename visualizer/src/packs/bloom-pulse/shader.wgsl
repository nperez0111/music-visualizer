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
  rings    : vec4<f32>, // x = ring count
  bloomAmt : vec4<f32>, // x = bloom intensity (used by post-FX pass)
  tint     : vec4<f32>, // xyz = core tint
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn palette(t: f32) -> vec3<f32> {
  return 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * t + vec3<f32>(0.0, 0.33, 0.66)));
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001;

  let r = length(uv);
  let theta = atan2(uv.y, uv.x);

  // Concentric rings, expanding with bass.
  let rings = clamp(p.rings.x, 4.0, 24.0);
  let speed = 0.6 + u.bass * 1.8 + u.rms * 0.4;
  let radial = r * rings - t * speed;
  let band = 0.5 + 0.5 * sin(radial * 2.0);

  // Angular modulation so the rings get rosette-like at high mids.
  let petals = 4.0 + floor(u.mid * 8.0);
  let angMod = 0.5 + 0.5 * cos(theta * petals + t * 1.2);

  let base = palette(radial * 0.05 + t * 0.07) * p.tint.xyz;
  var color = base * pow(band, 2.0) * (0.4 + 0.6 * angMod);

  // Beat punch at the center.
  let pulse = pow(1.0 - u.beat_phase, 8.0);
  color = color + vec3<f32>(1.0, 0.7, 0.4) * pulse * exp(-r * 5.0) * (0.5 + u.peak);

  // Treble shimmer.
  let shimmer = sin(theta * 12.0 + t * 8.0) * 0.5 + 0.5;
  color = color + vec3<f32>(shimmer * u.treble * 0.18);

  return vec4<f32>(color, 1.0);
}

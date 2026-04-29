// Standard pack uniform layout. Host fills these every frame.
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
  spectrum    : array<vec4<f32>, 8>, // 32 log-spaced FFT bins, indexed [i/4][i%4]
};

@group(0) @binding(0) var<uniform> u: Uniforms;

// Pack-declared parameters. Each parameter occupies one vec4 slot in manifest
// order; scalars use `.x`. See manifest.json for the slot map.
struct Params {
  speed   : vec4<f32>, // x = speed multiplier (0..4, default 1)
  warmth  : vec4<f32>, // xyz = palette tint color (RGB)
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn palette(t: f32) -> vec3<f32> {
  let a = vec3<f32>(0.5, 0.5, 0.5);
  let b = vec3<f32>(0.5, 0.5, 0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.00, 0.33, 0.67);
  return a + b * cos(6.28318 * (c * t + d));
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let uv  = pix * 2.0 - vec2<f32>(1.0, 1.0);
  let t = u.time_ms * 0.001 * p.speed.x;

  let r = length(uv) * (1.0 - 0.25 * u.bass);
  let theta = atan2(uv.y, uv.x) + t * 0.25 + u.mid * 0.8;

  let rings = 0.5 + 0.5 * sin(r * (5.0 + 8.0 * u.bass) - t * 1.6);
  let swirl = 0.5 + 0.5 * sin(theta * (4.0 + 4.0 * u.treble) + t * (1.0 + 1.5 * u.mid));

  let v = mix(rings, swirl, 0.5 + 0.4 * sin(t * 0.6));
  var color = palette(v + t * 0.05 + u.rms * 0.3);
  // Tint toward the user's warmth color, weighted by RMS.
  color = mix(color, color * p.warmth.xyz, 0.4);

  let pulse = pow(1.0 - u.beat_phase, 10.0) * (0.4 + u.peak * 0.6);
  color = color + vec3<f32>(pulse * 0.10);

  let vignette = smoothstep(1.4, 0.4, length(uv));
  color = color * vignette;

  return vec4<f32>(color, 1.0);
}

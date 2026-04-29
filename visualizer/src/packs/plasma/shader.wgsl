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

fn palette(t: f32) -> vec3<f32> {
  return 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * t + vec3<f32>(0.00, 0.20, 0.45)));
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv  = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001;

  // Classic plasma: sum of sines, with one source roaming with the bass.
  var v = sin(uv.x * 4.0 + t);
  v = v + sin(uv.y * 5.0 - t * 1.2);
  v = v + sin((uv.x + uv.y) * 6.0 + t * 0.7);
  let roam = vec2<f32>(sin(t * 0.9), cos(t * 1.3)) * (0.4 + 0.6 * u.bass);
  v = v + sin(length(uv - roam) * (8.0 + 5.0 * u.bass) - t * 2.0);
  v = v / 4.0;

  var color = palette(v + t * 0.05 + u.mid * 0.3);

  // Subtle channel swap on bass kick — shifts the perceived hue without
  // making the visual jump.
  color = mix(color, color.bgr, u.bass * 0.45);

  // Beat punch
  let pulse = pow(1.0 - u.beat_phase, 12.0) * (0.3 + u.peak * 0.5);
  color = color + vec3<f32>(pulse * 0.10);

  return vec4<f32>(color, 1.0);
}

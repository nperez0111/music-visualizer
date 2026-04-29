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

fn spectrumAt(idx: u32) -> f32 {
  let v = u.spectrum[idx >> 2u];
  let lane = idx & 3u;
  if (lane == 0u) { return v.x; }
  if (lane == 1u) { return v.y; }
  if (lane == 2u) { return v.z; }
  return v.w;
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let bars = 32.0;
  let xf = pix.x * bars;
  let xi = u32(clamp(xf, 0.0, bars - 1.0));
  let xfrac = fract(xf);
  let inGap = xfrac > 0.92;

  // Bar heights from the spectrum bin at this column. Square-root + clamp
  // matches the host's spectrum smoothing curve.
  let raw = max(spectrumAt(xi), 0.0);
  let mag = clamp(sqrt(raw) * 5.0, 0.02, 1.0);
  let fromBottom = 1.0 - pix.y;

  // Background: subtle vertical gradient.
  let bg = mix(vec3<f32>(0.04, 0.05, 0.08), vec3<f32>(0.02, 0.02, 0.04), pix.y);
  var color = bg;

  if (!inGap && fromBottom < mag) {
    let frac = f32(xi) / 31.0;
    // Hue gradient across bins: green-cyan → magenta-orange.
    let hue = mix(vec3<f32>(0.40, 0.95, 0.55), vec3<f32>(1.00, 0.30, 0.70), frac);
    let topGlow = smoothstep(mag - 0.06, mag, fromBottom);
    color = mix(hue, vec3<f32>(1.0, 1.0, 1.0), topGlow * 0.7);
    // Bass-driven brightness boost on the lower bands.
    color = color + vec3<f32>(u.bass * 0.10 * (1.0 - frac));
  }

  // Beat punch
  let pulse = pow(1.0 - u.beat_phase, 12.0) * (0.2 + u.peak * 0.4);
  color = color + vec3<f32>(pulse * 0.08);

  return vec4<f32>(color, 1.0);
}

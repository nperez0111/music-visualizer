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
  phosphor  : vec4<f32>, // xyz = trace color
  thickness : vec4<f32>, // x = thickness multiplier
  glow      : vec4<f32>, // x = bloom multiplier
};
@group(1) @binding(0) var<uniform> p: Params;

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

// Fake waveform: sum of sines weighted by spectrum bins.
fn wave(x: f32, t: f32) -> f32 {
  var y: f32 = 0.0;
  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    let freq = 1.5 + f32(i) * 1.7;
    let amp  = sqrt(max(spectrumAt(i), 0.0));
    let ph   = t * (0.6 + f32(i) * 0.18);
    y = y + amp * sin(x * freq + ph);
  }
  return y * 0.18;
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let uv  = pix * 2.0 - vec2<f32>(1.0, 1.0);
  let t = u.time_ms * 0.001;

  // CRT phosphor background — dark green with subtle scanlines.
  var color = vec3<f32>(0.0, 0.04, 0.02);
  let scan = 0.5 + 0.5 * sin(pix.y * u.resolution.y * 1.8);
  color = color * (0.85 + scan * 0.25);

  // Sample three time-shifted traces for thickness/persistence.
  let yw0 = wave(uv.x * 4.0, t);
  let yw1 = wave(uv.x * 4.0, t - 0.020);
  let yw2 = wave(uv.x * 4.0, t - 0.040);

  let thickness = (0.012 + u.bass * 0.025 + u.peak * 0.02) * p.thickness.x;
  let d0 = abs(uv.y - yw0);
  let d1 = abs(uv.y - yw1);
  let d2 = abs(uv.y - yw2);

  let g0 = smoothstep(thickness, 0.0, d0);
  let g1 = smoothstep(thickness * 1.4, 0.0, d1) * 0.55;
  let g2 = smoothstep(thickness * 1.8, 0.0, d2) * 0.30;
  let trace = max(g0, max(g1, g2));

  // Treble adds a hairline jitter overlay.
  let jitter = sin(uv.x * 80.0 + t * 30.0) * u.treble * 0.04;
  let dj = abs(uv.y - (yw0 + jitter));
  let gj = smoothstep(thickness * 0.6, 0.0, dj) * u.treble * 0.6;

  let phosphor = p.phosphor.xyz;
  color = color + phosphor * (trace + gj);

  // Bloom around the trace.
  color = color + phosphor * smoothstep(thickness * 6.0, 0.0, d0) * 0.18 * p.glow.x;

  let pulse = pow(1.0 - u.beat_phase, 14.0) * 0.15;
  color = color + phosphor * pulse;

  // Soft vignette.
  let vign = smoothstep(1.5, 0.4, length(uv));
  color = color * vign;

  return vec4<f32>(color, 1.0);
}

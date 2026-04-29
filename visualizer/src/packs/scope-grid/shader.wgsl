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
  traceColor : vec4<f32>, // xyz = phosphor color
  gridColor  : vec4<f32>, // xyz = graticule color
  thickness  : vec4<f32>, // x = thickness multiplier
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

// Lissajous point at parameter s.
fn liss(s: f32, t: f32, fx: f32, fy: f32, phase: f32) -> vec2<f32> {
  return vec2<f32>(
    sin(s * fx + t),
    sin(s * fy + t * 1.3 + phase)
  );
}

// Distance from p to the Lissajous curve, sampled across many s values.
fn lissDistance(p: vec2<f32>, t: f32, fx: f32, fy: f32, phase: f32) -> f32 {
  var minD: f32 = 1e9;
  // 64 samples — adequate for a smooth-looking trace.
  for (var i: i32 = 0; i < 64; i = i + 1) {
    let s = f32(i) / 63.0 * 6.28318;
    let q = liss(s, t, fx, fy, phase);
    let d = distance(p, q);
    if (d < minD) { minD = d; }
  }
  return minD;
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv  = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001;

  // CRT tint.
  var color = vec3<f32>(0.01, 0.03, 0.02);

  // Graticule: major divisions every 0.2, minor every 0.05.
  let majX = abs(fract(uv.x * 5.0 + 0.5) - 0.5);
  let majY = abs(fract(uv.y * 5.0 + 0.5) - 0.5);
  let majLine = smoothstep(0.02, 0.0, min(majX, majY)) * 0.18;
  let minDot = smoothstep(0.020, 0.0, distance(fract(uv * 5.0) - vec2<f32>(0.5, 0.5), vec2<f32>(0.0, 0.0))) * 0.0;
  // Center crosshair brighter.
  let cross = smoothstep(0.005, 0.0, min(abs(uv.x), abs(uv.y))) * 0.35;
  color = color + p.gridColor.xyz * (majLine + cross);

  // Two stacked Lissajous traces — band-driven frequency ratios.
  let fx = 2.0 + floor(u.bass * 5.0);   // 2..7
  let fy = 3.0 + floor(u.mid  * 4.0);   // 3..7
  let phase = u.treble * 3.14159;

  let d0 = lissDistance(uv, t,        fx, fy, phase);
  let d1 = lissDistance(uv, t - 0.02, fx, fy, phase);
  let d2 = lissDistance(uv, t - 0.05, fx, fy, phase);

  let thick = (0.012 + u.peak * 0.020) * p.thickness.x;
  let g0 = smoothstep(thick, 0.0, d0);
  let g1 = smoothstep(thick * 1.4, 0.0, d1) * 0.55;
  let g2 = smoothstep(thick * 1.8, 0.0, d2) * 0.30;
  let trace = max(g0, max(g1, g2));

  let phosphor = p.traceColor.xyz;
  color = color + phosphor * trace;
  color = color + phosphor * smoothstep(thick * 6.0, 0.0, d0) * 0.20;

  // Beat throws — small horizontal kick across the trace.
  let kick = pow(1.0 - u.beat_phase, 12.0);
  let kickLine = smoothstep(0.004, 0.0, abs(uv.y - sin(t * 9.0) * 0.4)) * kick * 0.4;
  color = color + phosphor * kickLine;

  // Scanlines.
  let scan = 0.5 + 0.5 * sin(pix.y * u.resolution.y * 1.4);
  color = color * (0.85 + scan * 0.20);

  // Bezel vignette.
  let vign = smoothstep(1.6, 0.4, length(uv));
  color = color * vign;

  return vec4<f32>(color, 1.0);
}

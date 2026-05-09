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
  blobSize  : vec4<f32>, // x = blob radius multiplier
  lavaColor : vec4<f32>, // xyz = blob tint
  bgColor   : vec4<f32>, // xyz = glass background top color
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn lavaPalette(t: f32) -> vec3<f32> {
  // Deep red -> orange -> yellow.
  let r = clamp(0.6 + 0.4 * cos(t * 6.28318 + 0.0), 0.0, 1.0);
  let g = clamp(0.3 + 0.4 * cos(t * 6.28318 + 0.6), 0.0, 1.0);
  let b = clamp(0.05 + 0.10 * cos(t * 6.28318 + 1.4), 0.0, 0.4);
  return vec3<f32>(r, g, b);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv  = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001 * (0.6 + u.mid * 0.6);

  // Background — dark amber, top color comes from params.
  let bg = mix(p.bgColor.xyz, p.bgColor.xyz * 0.2, pix.y);
  var color = bg;

  // Sum metaball field. 8 blobs orbiting on lissajous-like paths.
  var field: f32 = 0.0;
  let blobR = (0.30 + u.bass * 0.18) * p.blobSize.x;
  for (var i: i32 = 0; i < 8; i = i + 1) {
    let fi = f32(i);
    let phaseA = t * (0.20 + fi * 0.04) + fi * 1.7;
    let phaseB = t * (0.18 + fi * 0.05) + fi * 2.1;
    let cx = sin(phaseA) * (0.55 + 0.10 * sin(t + fi));
    let cy = cos(phaseB) * (0.55 + 0.10 * cos(t * 1.1 + fi));
    let c = vec2<f32>(cx, cy);

    // Beat pinches blobs slightly inward.
    let pinch = 1.0 - pow(1.0 - u.beat_phase, 8.0) * 0.25;
    let d = distance(uv, c * pinch);

    field = field + (blobR * (0.7 + 0.3 * sin(t + fi))) / max(d, 0.04);
  }

  // Threshold the field to draw the goo.
  let goo = smoothstep(2.6, 4.0, field);
  let edge = smoothstep(2.4, 2.6, field) - smoothstep(2.6, 2.8, field);

  let lava = lavaPalette(0.55 + u.rms * 0.20) * p.lavaColor.xyz;
  color = mix(color, lava, goo);

  // Hot rim/edge highlight.
  color = color + vec3<f32>(1.0, 0.6, 0.2) * edge * (0.6 + u.peak * 0.6);

  // Top-down glass tint and faint highlight strip.
  let glass = smoothstep(-0.9, 0.9, uv.y);
  color = color * (0.85 + glass * 0.15);
  color = color + vec3<f32>(0.05, 0.03, 0.0) * smoothstep(0.85, 1.0, pix.y);

  let pulse = pow(1.0 - u.beat_phase, 14.0) * 0.10;
  color = color + vec3<f32>(pulse, pulse * 0.6, 0.0);

  return vec4<f32>(color, 1.0);
}

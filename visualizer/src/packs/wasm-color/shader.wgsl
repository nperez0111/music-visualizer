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
  // Pack-defined custom region (offset 176): vec4<f32>(r, g, b, energy)
  packData    : vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let t = u.time_ms * 0.001;

  // Cell grid; jitter brightness per-cell using a hash-ish offset.
  let cellSize = 18.0;
  let cell = floor(pix * cellSize);
  let phaseSeed = (cell.x * 7.13 + cell.y * 13.71) * 0.317;
  let phase = sin(t * 1.4 + phaseSeed * 6.28318);
  let intensity = 0.35 + 0.65 * (phase * 0.5 + 0.5);

  // RGB + energy come from WASM each frame.
  var color = u.packData.rgb * intensity;
  color = color + vec3<f32>(u.packData.a * 0.45);

  // Subtle pulse on each beat
  let pulse = pow(1.0 - u.beat_phase, 10.0) * 0.08;
  color = color + vec3<f32>(pulse);

  return vec4<f32>(color, 1.0);
}

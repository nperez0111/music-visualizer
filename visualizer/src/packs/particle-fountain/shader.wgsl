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
  // 16 particles, each (x, y, size_alive, hue). Size_alive is 0 for dead.
  particles   : array<vec4<f32>, 16>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn palette(t: f32) -> vec3<f32> {
  return 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * t + vec3<f32>(0.0, 0.4, 0.7)));
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);

  // Background: dim vertical gradient with a subtle low-band wash.
  let bgTop = vec3<f32>(0.02, 0.025, 0.045);
  let bgBot = vec3<f32>(0.06, 0.04, 0.08);
  var color = mix(bgTop, bgBot, pix.y) + vec3<f32>(u.bass * 0.04, u.bass * 0.02, u.bass * 0.06);

  // Splat each particle as a soft glow.
  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    let p = u.particles[i];
    let size = p.z;
    if (size < 0.001) { continue; }
    let pos = vec2<f32>(p.x * aspect, p.y);
    let d = distance(uv, pos);
    let core = exp(-d * d / (size * size * 0.4));
    let halo = exp(-d / (size * 1.6));
    let hue = p.w;
    let pcol = palette(hue);
    color = color + pcol * (core * 1.4 + halo * 0.25);
  }

  // Beat punch
  let pulse = pow(1.0 - u.beat_phase, 14.0) * (0.15 + u.peak * 0.35);
  color = color + vec3<f32>(pulse * 0.08);

  return vec4<f32>(color, 1.0);
}

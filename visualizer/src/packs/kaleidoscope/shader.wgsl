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
  petals   : vec4<f32>, // x = base petal count
  spin     : vec4<f32>, // x = rotation speed multiplier (signed)
  softness : vec4<f32>, // x = second-tap mix amount
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn palette(t: f32) -> vec3<f32> {
  return 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * t + vec3<f32>(0.00, 0.30, 0.55)));
}

fn source(p: vec2<f32>, t: f32, bass: f32, mid: f32) -> vec3<f32> {
  // Plasma source sampled by the kaleidoscope wedge.
  let q = p + vec2<f32>(sin(t * 0.7), cos(t * 0.9)) * (0.4 + 0.6 * mid);
  var v = sin(q.x * 4.0 + t * 0.8);
  v = v + sin(q.y * 5.5 - t);
  v = v + sin(length(q) * (5.0 + 6.0 * bass) - t * 1.4);
  v = v / 3.0;
  return palette(v + t * 0.05);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv0  = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001;

  // Polar fold into N-fold symmetry with reflection.
  let segments = clamp(p.petals.x + floor(u.treble * 4.0), 3.0, 24.0);
  let r = length(uv0);
  var theta = atan2(uv0.y, uv0.x) + t * (0.15 * p.spin.x + u.bass * 0.6 * sign(p.spin.x + 0.0001));
  let segArc = 6.28318 / segments;
  // Floor-mod for robust wrap on negative theta, then mirror around segArc/2.
  let wrapped = theta - floor(theta / segArc) * segArc;
  theta = abs(wrapped - segArc * 0.5);

  let folded = vec2<f32>(cos(theta), sin(theta)) * r;

  // Sample plasma at folded position.
  var color = source(folded * 1.6, t, u.bass, u.mid);

  // Add a second tap with slight offset for sparkle.
  let folded2 = folded + vec2<f32>(sin(t * 1.3), cos(t * 1.7)) * 0.15;
  let c2 = source(folded2 * 2.2, t * 1.1, u.bass, u.mid);
  color = mix(color, c2, clamp(p.softness.x + u.treble * 0.4, 0.0, 1.0));

  // Petal seams: bright line at theta = 0.
  let seam = smoothstep(0.04, 0.0, theta) * (0.25 + u.peak * 0.6);
  color = color + vec3<f32>(seam);

  // Beat flash on the seam, decaying outward.
  let pulse = pow(1.0 - u.beat_phase, 8.0);
  color = color + vec3<f32>(pulse * 0.35) * smoothstep(1.4, 0.0, r);

  let vign = smoothstep(1.7, 0.5, r);
  color = color * vign;

  return vec4<f32>(color, 1.0);
}

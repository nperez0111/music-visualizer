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
  arms      : vec4<f32>, // x = number of spiral arms
  twistAmt  : vec4<f32>, // x = baseline twist (added to bass*8)
  coreColor : vec4<f32>, // xyz = singularity glow color
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn palette(t: f32) -> vec3<f32> {
  return 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * t + vec3<f32>(0.55, 0.20, 0.85)));
}

fn arms(uv: vec2<f32>, t: f32, twist: f32, count: f32) -> f32 {
  let r = length(uv);
  let theta = atan2(uv.y, uv.x);
  // Logarithmic spiral: theta + twist * log(r) defines arm angle.
  let phase = theta * count + twist * log(max(r, 0.001)) * count - t;
  let s = 0.5 + 0.5 * sin(phase);
  // Sharpen arms; thicken with energy.
  return pow(s, 4.0);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv  = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001;
  let r = length(uv);

  // Twist increases with bass — spiral tightens.
  let twist = p.twistAmt.x + u.bass * 8.0;
  let count = p.arms.x;
  let speed = 1.4 + u.rms * 1.6;

  // Three chromatic taps for prismatic shimmer.
  let aR = arms(uv, t * speed,        twist,        count);
  let aG = arms(uv, t * speed + 0.05, twist + 0.6 * u.treble, count);
  let aB = arms(uv, t * speed + 0.10, twist + 1.2 * u.treble, count);

  // Base swirl color from palette across radius.
  let baseT = r * 0.6 - t * 0.10 + atan2(uv.y, uv.x) * 0.15 / 6.28318;
  var color = palette(baseT);

  // Modulate by arm intensity, with chromatic split.
  let armCol = vec3<f32>(aR * 1.05, aG * 0.95, aB * 1.10);
  color = mix(color * 0.20, color * 1.20, armCol);

  // Radial fade: bright core, dark void at the edge.
  let coreGlow = exp(-r * 1.8) * (0.4 + u.bass * 0.9);
  color = color + p.coreColor.xyz * coreGlow;

  // Outer darkness to sell the void.
  let vign = smoothstep(1.6, 0.2, r);
  color = color * vign;

  let pulse = pow(1.0 - u.beat_phase, 10.0) * (0.3 + u.peak * 0.5);
  color = color + vec3<f32>(pulse * 0.3) * exp(-r * 2.0);

  return vec4<f32>(color, 1.0);
}

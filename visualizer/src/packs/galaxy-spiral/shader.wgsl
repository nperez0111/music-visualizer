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
  speed : vec4<f32>,
  arms  : vec4<f32>,
  core  : vec4<f32>,
  dust  : vec4<f32>,
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn hash21(v: vec2<f32>) -> f32 {
  return fract(sin(dot(v, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

fn fbm(p: vec2<f32>) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 5; i = i + 1) {
    v = v + a * vnoise(q);
    q = q * 2.02;
    a = a * 0.5;
  }
  return v;
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = vec2<f32>((pix.x - 0.5) * aspect, pix.y - 0.5);
  let t = u.time_ms * 0.001 * p.speed.x;

  let r = length(uv) + 1e-4;
  let a = atan2(uv.y, uv.x);

  let arm_count = max(2.0, floor(p.arms.x));
  let twist = 7.0;
  let rot_speed = 0.18 + 0.6 * u.mid;
  let spiral = sin(a * arm_count + r * twist - t * rot_speed);

  // Disk falloff and core.
  let disk = exp(-r * 3.0);
  let core_glow = exp(-r * 14.0) * (1.0 + 2.5 * u.bass);
  let core_halo = exp(-r * 5.5) * (0.25 + 0.6 * u.rms);

  // Dust + nebula.
  let dust   = fbm(uv * 3.5 + vec2<f32>(0.0, t * 0.06));
  let nebula = fbm(uv * 1.5 + vec2<f32>(t * 0.04, -t * 0.03));

  // Arm mask: where spiral peaks intersect disk.
  let arm_mask = smoothstep(-0.2, 0.9, spiral) * smoothstep(1.0, 0.05, r) * (0.55 + 0.7 * dust);

  // Background star field — sparser, twinkles with treble.
  let g = fbm(uv * 28.0);
  let speck = smoothstep(0.93, 1.0, g);
  let twinkle = 0.6 + 0.4 * sin(t * 3.0 + g * 30.0);
  let stars = speck * twinkle * (0.6 + 1.2 * u.treble);

  let intensity = disk * (0.35 + 0.55 * nebula) + arm_mask * 0.85 + stars * 1.3;

  // Color: dust tint for arms, core color in the center.
  var color = p.dust.xyz * intensity * 0.9;
  color = color + p.core.xyz * core_glow * 1.4;
  color = color + p.core.xyz * core_halo * 0.5;

  // Slight bluish dust highlight on the outer arms.
  color = color + vec3<f32>(0.2, 0.4, 0.9) * arm_mask * 0.25;

  // Beat adds a brief brightness boost to the whole disk.
  let pulse = pow(1.0 - u.beat_phase, 10.0) * (0.2 + u.peak * 0.5);
  color = color + p.core.xyz * pulse * 0.4 * disk;

  return vec4<f32>(color, 1.0);
}

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
  speed     : vec4<f32>, // x = flight speed multiplier
  tint      : vec4<f32>, // xyz = wall tint
  divisions : vec4<f32>, // x = vertical wall divisions count
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn palette(t: f32) -> vec3<f32> {
  return 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * t + vec3<f32>(0.10, 0.45, 0.85)));
}

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv  = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001;

  // Wobble center with mid-range energy so the tunnel sways.
  let centerWob = vec2<f32>(sin(t * 0.6), cos(t * 0.5)) * (0.05 + u.mid * 0.20);
  let q = uv - centerWob;

  let r = length(q);
  let theta = atan2(q.y, q.x);

  // Tunnel coordinates: depth = 1/r, angle wraps the wall.
  let bore = 0.55 + u.mid * 0.35;
  let depth = bore / max(r, 0.001);
  let speed = (1.6 + u.bass * 4.0 + u.rms * 1.2) * p.speed.x;
  let z = depth + t * speed;
  let a = theta * 3.0 / 6.28318 + 0.5;

  // Brick-pattern walls.
  let cell = vec2<f32>(z * 1.0, a * p.divisions.x);
  let id = floor(cell);
  let f  = fract(cell);
  let bw = step(0.06, f.x) * step(0.06, f.y) * step(f.x, 0.94) * step(f.y, 0.94);
  let n  = hash(id);

  // Color per cell from palette + spectrum bin.
  let bin = u32(clamp(fract(n + a) * 32.0, 0.0, 31.0));
  let bp = u.spectrum[bin >> 2u];
  let lane = bin & 3u;
  var spec: f32 = bp.x;
  if (lane == 1u) { spec = bp.y; }
  if (lane == 2u) { spec = bp.z; }
  if (lane == 3u) { spec = bp.w; }
  spec = clamp(sqrt(max(spec, 0.0)) * 4.0, 0.0, 1.0);

  var color = palette(n + t * 0.04 + spec * 0.5);
  color = color * (0.35 + bw * 0.85) * p.tint.xyz;

  // Treble shimmer — high-frequency phase noise on the walls.
  let shimmer = 0.5 + 0.5 * sin(z * 40.0 + a * 60.0 + t * 20.0);
  color = color + vec3<f32>(shimmer * u.treble * 0.20);

  // Distance fog — fade to black as r grows (camera nose).
  let fog = 1.0 - smoothstep(0.0, 1.6, 1.0 / max(r, 0.001));
  color = color * (0.25 + fog * 0.85);

  // Center glow — bass punches a bright dot at the vanishing point.
  let glow = exp(-r * 12.0) * (0.4 + u.bass * 0.8);
  color = color + vec3<f32>(glow * 0.7, glow * 0.5, glow);

  let pulse = pow(1.0 - u.beat_phase, 10.0) * 0.20;
  color = color + vec3<f32>(pulse);

  return vec4<f32>(color, 1.0);
}

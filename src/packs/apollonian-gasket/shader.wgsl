// 2D Apollonian gasket via repeated sphere-inversion folds.
// Reference: iq's "Apollonian" technique — fold space into a unit sphere
// each iteration, accumulate inverse-scale, and the running min distance
// to lattice features traces the gasket.

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
  speed : vec4<f32>, // x = speed multiplier
  scale : vec4<f32>, // x = fold scale (1.05..1.6)
  depth : vec4<f32>, // x = max iteration count
  tint  : vec4<f32>, // xyz = tint color
};
@group(1) @binding(0) var<uniform> p: Params;

const TAU : f32 = 6.28318530718;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn palette(t: f32, tint: vec3<f32>) -> vec3<f32> {
  let a = vec3<f32>(0.5);
  let b = vec3<f32>(0.5);
  let c = vec3<f32>(1.0, 1.0, 1.0);
  let d = vec3<f32>(0.0, 0.20, 0.55);
  return (a + b * cos(TAU * (c * t + d))) * tint;
}

// Apollonian-style fold: translate, modulo into a tile, sphere-invert.
fn apollonian(p_in: vec2<f32>, scale: f32, max_iter: u32) -> vec2<f32> {
  var z = p_in;
  var dz: f32 = 1.0;
  var trap: f32 = 1e9;
  for (var i: u32 = 0u; i < max_iter; i = i + 1u) {
    // Tile fold: wrap into [-1, 1] for both axes.
    z = (fract(z * 0.5 + vec2<f32>(0.5)) - vec2<f32>(0.5)) * 2.0;
    let r2 = dot(z, z);
    let k = scale / max(r2, 0.001);
    z = z * k;
    dz = dz * k;
    trap = min(trap, r2);
  }
  // Distance estimate (Hausdorff-like) and orbit-trap.
  let de = 0.5 * sqrt(max(dot(z, z), 1e-6)) / dz;
  return vec2<f32>(de, trap);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = vec2<f32>((pix.x - 0.5) * aspect, pix.y - 0.5) * 2.4;
  let t = u.time_ms * 0.001 * p.speed.x;

  let beat = pow(1.0 - u.beat_phase, 4.0);

  // Slow drift across the gasket plane; treble adds shimmer offset.
  let drift = vec2<f32>(
    0.35 * sin(t * 0.13) + u.treble * 0.05 * sin(t * 7.0),
    0.30 * cos(t * 0.17) + u.treble * 0.05 * cos(t * 6.3)
  );
  let zoom = 0.85 + 0.20 * sin(t * 0.21) - 0.15 * u.bass - 0.10 * beat;
  let z0 = uv * zoom + drift;

  // Bass deepens recursion; the user-supplied "depth" is the ceiling.
  let userDepth = clamp(p.depth.x, 4.0, 18.0);
  let depth = u32(clamp(userDepth + 4.0 * u.bass, 4.0, 18.0));

  // Mid bends the fold scale; clamp to a safe range so the visual stays alive.
  let scale = clamp(p.scale.x + 0.08 * (u.mid - 0.5), 1.05, 1.6);

  let result = apollonian(z0, scale, depth);
  let de = result.x;
  let trap = result.y;

  // Edge intensity: distance estimate -> bright lines on the gasket boundary.
  let edge = 1.0 / (1.0 + de * (220.0 + 240.0 * (1.0 - u.rms)));

  // Color from orbit-trap, modulated by time and treble.
  let hue = clamp(trap, 0.0, 1.0) * 0.6 + t * 0.04 + u.treble * 0.5;
  var color = palette(hue, p.tint.xyz) * edge;

  // Beat punch along the brightest filaments.
  color = color + p.tint.xyz * edge * beat * (0.4 + 0.6 * u.peak);

  // Subtle base glow so empty regions aren't pure black.
  color = color + p.tint.xyz * 0.025 * u.bass;

  let vignette = smoothstep(1.7, 0.4, length(uv));
  color = color * vignette;

  return vec4<f32>(color, 1.0);
}

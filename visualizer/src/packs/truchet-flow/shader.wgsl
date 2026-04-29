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
  speed     : vec4<f32>,
  scale     : vec4<f32>,
  tint      : vec4<f32>,
  thickness : vec4<f32>,
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn hash12(v: vec2<f32>) -> f32 {
  let h = dot(v, vec2<f32>(127.1, 311.7));
  return fract(sin(h) * 43758.5453);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = vec2<f32>((pix.x - 0.5) * aspect, pix.y - 0.5);
  let t = u.time_ms * 0.001 * p.speed.x;

  // Drift the field, with a slow bass-driven warp.
  let warp = vec2<f32>(sin(t * 0.4), cos(t * 0.3)) * (0.05 + 0.15 * u.bass);
  let st = (uv + warp) * p.scale.x + vec2<f32>(t * 0.3, t * 0.2);

  let cell = floor(st);
  var frc  = fract(st) - vec2<f32>(0.5);

  // Random per-tile flip — selects one of two quarter-arc orientations.
  let flip = step(0.5, hash12(cell));
  if (flip > 0.5) {
    frc = vec2<f32>(frc.x, -frc.y);
  }

  // Distance to the two quarter circles (centered at opposite corners).
  let d1 = abs(length(frc - vec2<f32>(-0.5, -0.5)) - 0.5);
  let d2 = abs(length(frc - vec2<f32>( 0.5,  0.5)) - 0.5);
  let d  = min(d1, d2);

  let line_w = p.thickness.x * (0.7 + 0.8 * u.mid);
  let line   = smoothstep(line_w, line_w * 0.5, d);

  // Travel parameter along the arc, used to color a flowing stripe along the line.
  let theta = atan2(frc.y + 0.5, frc.x + 0.5);
  let travel = theta + t * 1.2 + hash12(cell) * 6.2831;
  let stripe = 0.5 + 0.5 * sin(travel * 4.0);

  // Background color tinted toward complement; foreground is the user tint shifted by bass.
  let hue_shift = 0.05 + 0.4 * u.bass;
  let fg = mix(p.tint.xyz, p.tint.zxy, hue_shift);
  let bg = vec3<f32>(0.04, 0.05, 0.10) + 0.05 * p.tint.xyz;

  var color = mix(bg, fg * (0.5 + 0.7 * stripe), line);

  let pulse = pow(1.0 - u.beat_phase, 6.0) * (0.3 + u.peak * 0.5);
  color = color + fg * pulse * 0.2;

  let vignette = smoothstep(1.3, 0.4, length(uv));
  color = color * vignette;

  return vec4<f32>(color, 1.0);
}

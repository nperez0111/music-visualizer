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
  speed  : vec4<f32>,
  zoom   : vec4<f32>,
  radius : vec4<f32>,
  tint   : vec4<f32>,
};
@group(1) @binding(0) var<uniform> p: Params;

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
  let d = vec3<f32>(0.0, 0.33, 0.67);
  return (a + b * cos(6.2831 * (c * t + d))) * tint;
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = vec2<f32>((pix.x - 0.5) * aspect, pix.y - 0.5);
  let t = u.time_ms * 0.001 * p.speed.x;

  // Constant c orbits a circle. Beat phase nudges its angular speed —
  // when a beat fires, c snaps forward; between beats it idles.
  let beat_kick = pow(1.0 - u.beat_phase, 3.0) * 0.6;
  let phase = t * 0.4 + beat_kick;
  let r_c = p.radius.x + 0.03 * u.bass;
  let cx = r_c * cos(phase);
  let cy = r_c * sin(phase * 0.7);
  let c = vec2<f32>(cx, cy);

  // Zoom is gently pumped by RMS so loud passages "breathe."
  let zoom = p.zoom.x / (1.0 + 0.3 * u.rms);
  var z = uv * zoom;

  let max_iter: i32 = 96;
  var smooth_iter: f32 = 0.0;
  var escaped: bool = false;

  for (var i: i32 = 0; i < max_iter; i = i + 1) {
    let x = z.x * z.x - z.y * z.y + c.x;
    let y = 2.0 * z.x * z.y + c.y;
    z = vec2<f32>(x, y);
    let dz = dot(z, z);
    if (dz > 64.0) {
      smooth_iter = f32(i) - log2(log2(dz)) + 4.0;
      escaped = true;
      break;
    }
  }

  var color: vec3<f32>;
  if (!escaped) {
    color = p.tint.xyz * 0.05;
  } else {
    let t_color = smooth_iter * 0.04 + t * 0.05 + u.treble * 0.6;
    color = palette(t_color, p.tint.xyz);
  }

  // Beat punch.
  let pulse = pow(1.0 - u.beat_phase, 8.0) * (0.2 + u.peak * 0.4);
  color = color + vec3<f32>(pulse * 0.10);

  let vignette = smoothstep(1.4, 0.4, length(uv));
  color = color * vignette;

  return vec4<f32>(color, 1.0);
}

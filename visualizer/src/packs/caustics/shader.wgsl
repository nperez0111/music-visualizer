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
  speed      : vec4<f32>,
  iterations : vec4<f32>,
  tint       : vec4<f32>,
  intensity  : vec4<f32>,
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

const TAU: f32 = 6.28318530718;

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let t = u.time_ms * 0.001 * p.speed.x * (0.7 + 0.8 * u.treble);

  // Reconstruct the algorithm from haruyou27's port of MdlXz8:
  //   p = mod(uv * TAU, TAU) - 250
  //   iterate: i = p + (cos(t-i.x)+sin(t+i.y), sin(t-i.y)+cos(t+i.x))
  //   accumulate 1/length(...)
  var ip = (vec2<f32>(uv.x * aspect, uv.y) % vec2<f32>(1.0)) * TAU;
  ip = ip - vec2<f32>(250.0, 250.0);
  var iter_p = ip;
  var c: f32 = 1.0;

  let intensity = p.intensity.x * (1.0 + 0.6 * u.bass);
  let n = i32(clamp(p.iterations.x, 3.0, 8.0));

  for (var k: i32 = 0; k < n; k = k + 1) {
    iter_p = ip + vec2<f32>(
      cos(t - iter_p.x) + sin(t + iter_p.y),
      sin(t - iter_p.y) + cos(t + iter_p.x)
    );
    let denom = vec2<f32>(
      sin(iter_p.x + t) / intensity,
      cos(iter_p.y + t) / intensity
    );
    c = c + 1.0 / max(length(vec2<f32>(ip.x / denom.x, ip.y / denom.y)), 1e-4);
  }

  c = c / f32(n);
  c = 1.17 - pow(abs(c), 1.4);
  let bright = pow(abs(c), 8.0);

  // Compose against tinted water color.
  var color = vec3<f32>(bright) + p.tint.xyz;
  color = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));

  // Add a subtle blue depth gradient.
  let depth = mix(0.6, 1.1, uv.y);
  color = color * depth;

  // Beat punch — caustic flash.
  let pulse = pow(1.0 - u.beat_phase, 8.0) * (0.2 + u.peak * 0.4);
  color = color + vec3<f32>(0.6, 0.9, 1.0) * pulse * 0.15;

  return vec4<f32>(color, 1.0);
}

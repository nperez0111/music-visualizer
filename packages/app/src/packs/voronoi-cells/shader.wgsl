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
  speed   : vec4<f32>,
  density : vec4<f32>,
  tint    : vec4<f32>,
  edge    : vec4<f32>,
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
  let q = vec2<f32>(
    dot(p, vec2<f32>(127.1, 311.7)),
    dot(p, vec2<f32>(269.5, 183.3))
  );
  return fract(sin(q) * 43758.5453);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = vec2<f32>((pix.x - 0.5) * aspect, pix.y - 0.5);
  let t = u.time_ms * 0.001 * p.speed.x;

  let dens = p.density.x + 4.0 * u.bass;
  let scroll = vec2<f32>(t * 0.15, t * 0.10 + u.mid * 0.4);
  let st = uv * dens + scroll;

  let cell = floor(st);
  let frc  = fract(st);

  var f1: f32 = 8.0;
  var f2: f32 = 8.0;

  for (var j: i32 = -1; j <= 1; j = j + 1) {
    for (var i: i32 = -1; i <= 1; i = i + 1) {
      let neighbor = vec2<f32>(f32(i), f32(j));
      let r = hash22(cell + neighbor);
      // Animate point inside cell — bass amplifies the wobble.
      let jitter = 0.5 + 0.5 * sin(t * 1.2 + 6.2831 * r) * (0.6 + 0.6 * u.bass);
      let pt = neighbor + jitter;
      let d = length(pt - frc);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
  }

  // F2 - F1 is the classic Voronoi edge distance.
  let edge_d = f2 - f1;
  let edge   = smoothstep(0.05, 0.0, edge_d) * (p.edge.x + 1.5 * u.treble);

  // Cell-fill color modulated by F1 (distance to nearest point).
  var fill = vec3<f32>(
    0.5 + 0.5 * cos(6.2831 * (f1 + t * 0.05) + vec3<f32>(0.0, 0.6, 1.2))
  );
  fill = mix(fill, fill * p.tint.xyz, 0.6);
  // Slight bass-driven brightening.
  fill = fill * (0.8 + 0.4 * u.rms);

  var color = mix(fill, p.tint.xyz * 1.5, edge);

  let pulse = pow(1.0 - u.beat_phase, 8.0) * (0.2 + u.peak * 0.4);
  color = color + vec3<f32>(pulse * 0.15);

  let vignette = smoothstep(1.2, 0.3, length(uv));
  color = color * vignette;

  return vec4<f32>(color, 1.0);
}

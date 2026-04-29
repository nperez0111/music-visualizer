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
  height   : vec4<f32>, // x = baseline flame height (0.2..1)
  hotColor : vec4<f32>, // xyz = tint applied to the brightest part of the flame
  embers   : vec4<f32>, // x > 0.5 enables ember sparks
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn hash(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn vnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let a = hash(i);
  let b = hash(i + vec2<f32>(1.0, 0.0));
  let c = hash(i + vec2<f32>(0.0, 1.0));
  let d = hash(i + vec2<f32>(1.0, 1.0));
  let s = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

fn fbm(p: vec2<f32>) -> f32 {
  var v: f32 = 0.0;
  var amp: f32 = 0.5;
  var freq: vec2<f32> = p;
  for (var i: i32 = 0; i < 5; i = i + 1) {
    v = v + amp * vnoise(freq);
    freq = freq * 2.0;
    amp = amp * 0.5;
  }
  return v;
}

fn firePalette(t: f32) -> vec3<f32> {
  // Black -> red -> orange -> yellow -> white.
  let r = clamp(t * 1.6, 0.0, 1.0);
  let g = clamp(t * 1.6 - 0.4, 0.0, 1.0);
  let b = clamp(t * 1.4 - 0.85, 0.0, 1.0);
  return vec3<f32>(r, g, b);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let t = u.time_ms * 0.001;

  // Flip so y=0 is the floor.
  let uv = vec2<f32>(pix.x, 1.0 - pix.y);

  // Domain warp upward — hot air rising.
  let speed = 0.6 + u.bass * 1.6 + u.rms * 0.4;
  var q = vec2<f32>(uv.x * 3.0, uv.y * 4.0 - t * speed);

  // Horizontal sway.
  q.x = q.x + sin(uv.y * 8.0 + t * 1.4) * (0.10 + u.mid * 0.30);

  let n = fbm(q);

  // Vertical falloff so flame hugs the bottom; bass raises the ceiling.
  let height = p.height.x + u.bass * 0.35 + u.peak * 0.10;
  let mask = smoothstep(height, 0.0, uv.y);

  // Heat: combine noise with mask, sharpen edges with treble.
  var heat = n * mask * (1.4 + u.treble * 0.6);
  heat = pow(heat, 1.6 - u.bass * 0.5);

  var color = firePalette(heat);
  // Tint the hot tip toward the user's chosen color.
  color = mix(color, color * p.hotColor.xyz, smoothstep(0.55, 1.0, heat));

  // Embers: occasional bright sparks above the flame line.
  let cellSize = vec2<f32>(60.0, 90.0);
  let cell = floor(uv * cellSize);
  let f = fract(uv * cellSize);
  let h1 = hash(cell);
  let h2 = hash(cell + vec2<f32>(7.0, 13.0));
  let emberLife = fract(h1 + t * (0.4 + u.bass * 1.2) * (0.6 + h2 * 0.8));
  let emberY = 1.0 - emberLife;
  let emberPos = vec2<f32>(0.5 + (h2 - 0.5) * 0.8, emberY);
  let emberDist = distance(f, emberPos);
  let emberAlive = step(0.6, h1) * smoothstep(0.6, 0.0, abs(uv.y - height + emberLife * 0.6));
  let emberOn = step(0.5, p.embers.x);
  let ember = exp(-emberDist * 30.0) * emberAlive * (0.6 + u.peak * 0.6) * emberOn;
  color = color + vec3<f32>(1.0, 0.6, 0.2) * ember;

  // Beat flash low across the floor.
  let pulse = pow(1.0 - u.beat_phase, 12.0);
  color = color + vec3<f32>(1.0, 0.4, 0.1) * pulse * smoothstep(0.5, 0.0, uv.y) * 0.4;

  return vec4<f32>(color, 1.0);
}

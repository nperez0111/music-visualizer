// Post-FX pass: brightness threshold + small multi-tap blur, additively combined
// with the main pass's output.

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
  rings    : vec4<f32>,
  bloomAmt : vec4<f32>,
  tint     : vec4<f32>,
};
@group(1) @binding(0) var<uniform> p: Params;

@group(3) @binding(0) var src_samp : sampler;
@group(3) @binding(1) var src_tex  : texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn brightness(c: vec3<f32>) -> f32 {
  return max(c.r, max(c.g, c.b));
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag_pos.xy / u.resolution;
  let texel = vec2<f32>(1.0) / u.resolution;

  // Original color (passed through).
  let base = textureSample(src_tex, src_samp, uv);

  // Threshold + blur. Thirteen taps in a small star pattern; weights sum to ~1.
  let bloomRadius = 6.0 + 12.0 * u.bass;
  let weights = array<f32, 13>(
    1.0, 0.85, 0.85, 0.85, 0.85,
    0.55, 0.55, 0.55, 0.55,
    0.35, 0.35, 0.35, 0.35,
  );
  let offsets = array<vec2<f32>, 13>(
    vec2<f32>( 0.0,  0.0),
    vec2<f32>( 1.0,  0.0), vec2<f32>(-1.0,  0.0),
    vec2<f32>( 0.0,  1.0), vec2<f32>( 0.0, -1.0),
    vec2<f32>( 0.7,  0.7), vec2<f32>(-0.7,  0.7),
    vec2<f32>( 0.7, -0.7), vec2<f32>(-0.7, -0.7),
    vec2<f32>( 2.0,  0.0), vec2<f32>(-2.0,  0.0),
    vec2<f32>( 0.0,  2.0), vec2<f32>( 0.0, -2.0),
  );

  var glow = vec3<f32>(0.0);
  var wSum: f32 = 0.0;
  for (var i: i32 = 0; i < 13; i = i + 1) {
    let off = offsets[i] * texel * bloomRadius;
    let s = textureSample(src_tex, src_samp, uv + off).rgb;
    let bright = max(0.0, brightness(s) - 0.55);
    glow = glow + s * bright * weights[i];
    wSum = wSum + weights[i];
  }
  glow = glow / wSum;

  let amt = clamp(p.bloomAmt.x, 0.0, 1.5);
  return vec4<f32>(base.rgb + glow * amt, 1.0);
}

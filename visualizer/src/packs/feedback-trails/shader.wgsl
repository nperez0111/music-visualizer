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
@group(2) @binding(0) var prev_samp : sampler;
@group(2) @binding(1) var prev_tex  : texture_2d<f32>;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn palette(t: f32) -> vec3<f32> {
  return 0.5 + 0.5 * cos(6.28318 * (vec3<f32>(1.0, 1.0, 1.0) * t + vec3<f32>(0.0, 0.4, 0.7)));
}

fn rand1(x: f32) -> f32 {
  return fract(sin(x * 12.9898) * 43758.5453);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv  = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);

  // Warp the previous-frame UV: zoom toward center + small audio-driven rotation.
  let center = vec2<f32>(0.5, 0.5);
  let toC = pix - center;
  let zoom = 1.0 + 0.006 + u.bass * 0.012;
  let rot = (u.mid - 0.5) * 0.05 + sin(u.time_ms * 0.0003) * 0.01;
  let cR = cos(rot);
  let sR = sin(rot);
  let rotated = vec2<f32>(toC.x * cR - toC.y * sR, toC.x * sR + toC.y * cR);
  let warpedUV = center + rotated / zoom;

  // Sample + decay. Decay is faster when there's more energy so beats don't blow out.
  let prev = textureSample(prev_tex, prev_samp, warpedUV);
  let decay = 0.94 - u.peak * 0.06;
  let trail = prev.rgb * decay;

  // Beat-triggered starburst at a beat-seeded random position.
  let secondsPerBeat = 60.0 / max(u.bpm, 60.0);
  let beatCount = floor(u.time_ms * 0.001 / secondsPerBeat);
  let bx = rand1(beatCount * 1.0) * 2.0 - 1.0;
  let by = rand1(beatCount * 1.7 + 4.1) * 2.0 - 1.0;
  let burstPos = vec2<f32>(bx * aspect * 0.7, by * 0.7);

  let bd = length(uv - burstPos);
  let burstFalloff = pow(1.0 - u.beat_phase, 16.0);
  let burstCore = exp(-bd * bd * 60.0) * burstFalloff;
  let burstHalo = exp(-bd * 6.0) * burstFalloff * 0.25;

  let burstHue = fract(beatCount * 0.137 + u.bass * 0.3);
  let burstCol = palette(burstHue) * (0.9 + u.peak * 0.6);

  let color = trail + burstCol * (burstCore + burstHalo);
  return vec4<f32>(color, 1.0);
}

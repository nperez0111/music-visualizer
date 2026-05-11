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
  coreSize  : vec4<f32>, // x = inner radius the bars start from
  coreColor : vec4<f32>, // xyz = core glow color
  rimColor  : vec4<f32>, // xyz = outer rim color
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn spectrumAt(idx: u32) -> f32 {
  let v = u.spectrum[idx >> 2u];
  let lane = idx & 3u;
  if (lane == 0u) { return v.x; }
  if (lane == 1u) { return v.y; }
  if (lane == 2u) { return v.z; }
  return v.w;
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv  = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001;

  let r = length(uv);
  let theta = atan2(uv.y, uv.x) + t * 0.10 + u.mid * 0.6;

  // Map angle to bin index 0..31 (whole turn covers all 32 bins).
  let bins = 32.0;
  let af = ((theta / 6.28318) + 0.5) * bins;
  let ai = u32(clamp(af, 0.0, bins - 1.0));
  let afrac = fract(af);
  let inGap = afrac < 0.06 || afrac > 0.94;

  // Inner radius: radial bars sit between r0 and r0 + bar height.
  let coreR = p.coreSize.x + u.bass * 0.10;
  let raw = max(spectrumAt(ai), 0.0);
  let mag = clamp(sqrt(raw) * 5.0, 0.0, 1.0);
  let barEnd = coreR + mag * (0.65 + u.peak * 0.20);

  var color = vec3<f32>(0.02, 0.03, 0.05);

  // Bar.
  if (!inGap && r > coreR && r < barEnd) {
    let frac = f32(ai) / 31.0;
    let hue = mix(vec3<f32>(0.30, 0.85, 1.00), vec3<f32>(1.00, 0.35, 0.60), frac);
    let topGlow = smoothstep(barEnd - 0.04, barEnd, r);
    color = mix(hue, vec3<f32>(1.0, 1.0, 1.0), topGlow * 0.8);
  }

  // Outer rim ring lit by treble.
  let rimR = 0.92;
  let rim = smoothstep(0.02, 0.0, abs(r - rimR)) * (0.3 + u.treble * 1.2);
  color = color + p.rimColor.xyz * rim;

  // Inner core: glowing bass-driven ball.
  let core = exp(-r * (12.0 - u.bass * 6.0));
  color = color + p.coreColor.xyz * core * (0.4 + u.bass * 1.0);

  // Beat punch on the core.
  let pulse = pow(1.0 - u.beat_phase, 12.0) * 0.35;
  color = color + vec3<f32>(pulse) * smoothstep(0.4, 0.0, r);

  return vec4<f32>(color, 1.0);
}

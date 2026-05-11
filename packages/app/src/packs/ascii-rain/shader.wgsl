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
  headColor  : vec4<f32>, // xyz = bright head pixel color
  trailColor : vec4<f32>, // xyz = trail tint (cooled by spectrum)
  fall       : vec4<f32>, // x = fall speed multiplier
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

fn spectrumAt(idx: u32) -> f32 {
  let v = u.spectrum[idx >> 2u];
  let lane = idx & 3u;
  if (lane == 0u) { return v.x; }
  if (lane == 1u) { return v.y; }
  if (lane == 2u) { return v.z; }
  return v.w;
}

// Fake glyph: small bitmap-ish pattern from per-cell hash + sub-cell uv.
fn glyph(cell: vec2<f32>, glyphId: f32, sub: vec2<f32>) -> f32 {
  // 5x7 grid of pixels; on/off picked per (cell,glyph,row,col).
  let g = floor(sub * vec2<f32>(5.0, 7.0));
  let key = vec2<f32>(cell.x * 13.0 + g.x + glyphId * 1.7,
                      cell.y * 17.0 + g.y - glyphId * 2.3);
  let on = step(0.5, hash(key));
  // Pixel margin so dots are visible, not a solid block.
  let local = fract(sub * vec2<f32>(5.0, 7.0));
  let mask = step(0.15, local.x) * step(local.x, 0.85)
           * step(0.15, local.y) * step(local.y, 0.85);
  return on * mask;
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let t = u.time_ms * 0.001;

  // Grid: ~64 columns, ~36 rows. Aspect-aware so glyphs stay roughly square.
  let cols = 64.0;
  let rows = floor(cols * (u.resolution.y / u.resolution.x) * (5.0 / 7.0));
  let cellSize = vec2<f32>(1.0 / cols, 1.0 / rows);

  // y from top so rain falls naturally.
  let yTop = 1.0 - pix.y;
  let cellX = floor(pix.x * cols);
  let cellY = floor(yTop * rows);
  let sub = vec2<f32>(fract(pix.x * cols), fract(yTop * rows));

  // Per-column properties.
  let colHash = hash(vec2<f32>(cellX, 7.0));
  let speed = (4.0 + colHash * 8.0 + u.treble * 12.0) * p.fall.x;
  let tailLen = 8.0 + colHash * 14.0 + u.bass * 10.0;

  // Head position (in cell units) for this column at time t. Use floor-mod
  // so negative inputs still wrap into [0, period).
  let period = rows + tailLen;
  let raw = t * speed + colHash * 50.0;
  let headPos = raw - floor(raw / period) * period;
  // How far above the head this cell is (positive = trail).
  let dist = headPos - cellY;

  // Brightness as a function of distance from the head.
  var brightness: f32 = 0.0;
  if (dist >= 0.0 && dist < tailLen) {
    brightness = 1.0 - dist / tailLen;
    brightness = pow(brightness, 1.6);
    if (dist < 1.0) { brightness = 1.0; }
  }

  // Glyph swap timer — re-roll which glyph each cell shows.
  let glyphTick = floor(t * 12.0 + colHash * 30.0 + cellY * 0.7);
  let glyphId = hash(vec2<f32>(cellX, cellY) + glyphTick);
  let lit = glyph(vec2<f32>(cellX, cellY), glyphId, sub);

  // Color tint: column maps to a spectrum bin.
  let bin = u32(clamp((cellX / cols) * 32.0, 0.0, 31.0));
  let spec = clamp(sqrt(max(spectrumAt(bin), 0.0)) * 4.0, 0.0, 1.0);
  let baseGreen = p.trailColor.xyz;
  let hot = vec3<f32>(1.00, 0.85, 0.45);
  let tint = mix(baseGreen, hot, spec * 0.7);

  var color = vec3<f32>(0.0, 0.02, 0.0);

  // Trail body — tinted, dimmer.
  color = color + tint * lit * brightness * 0.85;

  // Bright head when dist < 1.
  if (dist >= 0.0 && dist < 1.0) {
    color = color + p.headColor.xyz * lit * (0.7 + u.bass * 0.6);
  }

  // Bass-driven slight bloom along the head row.
  let headGlow = exp(-abs(dist) * 1.5) * u.bass * 0.15;
  color = color + tint * headGlow;

  // Beat flash — global green wash.
  let pulse = pow(1.0 - u.beat_phase, 14.0) * 0.10;
  color = color + vec3<f32>(0.0, pulse, 0.0);

  return vec4<f32>(color, 1.0);
}

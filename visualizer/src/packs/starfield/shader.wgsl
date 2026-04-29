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
  warpBase : vec4<f32>, // x = baseline warp speed (added to bass*1.6)
  nearTint : vec4<f32>, // xyz = color for low-spectrum stars
  farTint  : vec4<f32>, // xyz = color for high-spectrum stars
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn hash2(p: vec2<f32>) -> vec2<f32> {
  let q = vec2<f32>(
    dot(p, vec2<f32>(127.1, 311.7)),
    dot(p, vec2<f32>(269.5, 183.3))
  );
  return fract(sin(q) * 43758.5453);
}

fn hash1(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(91.7, 47.3))) * 12345.6789);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv  = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, 1.0);
  let t = u.time_ms * 0.001;

  var color = vec3<f32>(0.0, 0.0, 0.02);

  let warp = p.warpBase.x + u.bass * 1.6 + u.rms * 0.6;

  // Several star layers at different "depths".
  for (var layer: i32 = 0; layer < 4; layer = layer + 1) {
    let lf = f32(layer);
    let speed = 0.18 + lf * 0.22;
    let cellSize = 0.10 + lf * 0.05;

    // Per-layer time creates the rush; modulo to keep stars cycling.
    let zt = t * speed * (1.0 + warp * 1.5);
    let scale = (lf + 1.0) * 1.4 + (zt % 2.0);
    let q = uv * scale;

    let cell = floor(q);
    let f    = fract(q);
    let h    = hash2(cell);

    // Star position inside the cell.
    let starP = h;
    let d = distance(f, starP);

    let twinkle = 0.7 + 0.3 * sin(t * 4.0 + hash1(cell) * 30.0);
    let core = exp(-d * (60.0 - lf * 6.0)) * twinkle;

    // Streak from radial outward motion (warp lines).
    let radial = normalize(uv + vec2<f32>(0.0001));
    let along  = abs(dot(f - starP, vec2<f32>(-radial.y, radial.x)));
    let streakLen = 0.35 + warp * 0.6;
    let streak = exp(-along * 200.0) * smoothstep(streakLen, 0.0, distance(f, starP)) * warp;

    // Star tint from spectrum bin index by hash.
    let bin = u32(clamp(h.x * 32.0, 0.0, 31.0));
    let bp = u.spectrum[bin >> 2u];
    let lane = bin & 3u;
    var spec: f32 = bp.x;
    if (lane == 1u) { spec = bp.y; }
    if (lane == 2u) { spec = bp.z; }
    if (lane == 3u) { spec = bp.w; }
    let tint = mix(p.nearTint.xyz, p.farTint.xyz, clamp(spec * 6.0, 0.0, 1.0));

    let layerWeight = 1.0 - lf * 0.18;
    color = color + tint * (core + streak * 0.6) * layerWeight;
  }

  // Center bloom — beats flare the camera.
  let r = length(uv);
  let bloom = exp(-r * 3.0) * pow(1.0 - u.beat_phase, 8.0) * 0.5;
  color = color + vec3<f32>(bloom);

  // Slight blue tint deepens with rms.
  color = color + vec3<f32>(0.0, 0.01, 0.04) * u.rms;

  return vec4<f32>(color, 1.0);
}

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
  zoom       : vec4<f32>,
  tint       : vec4<f32>,
  iterations : vec4<f32>,
  symmetry   : vec4<f32>,
};
@group(1) @binding(0) var<uniform> p: Params;

const TAU : f32 = 6.28318530718;
const TARGET_S : f32 = 26.0;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

// POI table — same boundary points the perturbation pack uses, with a per-POI
// view radius so each region is framed at a sensible scale.
//   .xy = c-plane center, .z = camera radius multiplier.
fn poi(idx: u32) -> vec3<f32> {
  if (idx == 0u) { return vec3<f32>(-0.745, 0.108, 1.40); }      // Seahorse Valley
  if (idx == 1u) { return vec3<f32>(-0.10110, 0.95629, 1.05); }  // Misiurewicz
  if (idx == 2u) { return vec3<f32>(-1.62432, 0.0, 0.55); }      // Tante Renate
  return vec3<f32>(0.42884, -0.231345, 0.85);                    // Paul Bourke
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = vec2<f32>((pix.x - 0.5) * aspect, pix.y - 0.5) * 2.0;
  let t = u.time_ms * 0.001 * p.speed.x;

  let beat = pow(1.0 - u.beat_phase, 4.0);

  // POI cycle: most of each period sits on one POI, last ~18% smoothsteps to the next.
  let cycle = max(t, 0.0) / TARGET_S;
  let i0 = u32(floor(cycle)) % 4u;
  let i1 = (i0 + 1u) % 4u;
  let local = cycle - floor(cycle);
  let ease = smoothstep(0.82, 1.0, local);

  let pA = poi(i0);
  let pB = poi(i1);
  let centerBase = mix(pA.xy, pB.xy, ease);
  let radius = mix(pA.z, pB.z, ease);

  // Wobble keeps the camera gently moving while parked on a POI.
  let wobble = vec2<f32>(
    0.10 * radius * sin(t * 0.21),
    0.08 * radius * cos(t * 0.27)
  );
  let center = centerBase + wobble;

  // Kaleidoscope fold: collapse uv into one wedge of an N-fold rotational
  // symmetry, mirroring at slice boundaries so the seams stay continuous.
  // symmetry.x = number of folds (1 disables the fold).
  let folds = clamp(p.symmetry.x, 1.0, 12.0);
  var sampleUv = uv;
  if (folds > 1.5) {
    let r = length(uv);
    let theta = atan2(uv.y, uv.x);
    let slice = TAU / folds;
    let halfSlice = slice * 0.5;
    let wrapped = theta - TAU * floor(theta / TAU);
    let localT = wrapped - slice * floor(wrapped / slice);
    let folded = abs(localT - halfSlice);     // [0, halfSlice]
    // Slowly rotate the kaleidoscope; treble nudges it faster so highs sparkle.
    let rot = t * 0.08 + u.treble * 0.6;
    let a = folded + rot;
    sampleUv = vec2<f32>(cos(a), sin(a)) * r;
  }

  // Camera zoom: oscillates within the POI radius; bass contracts the view, beats snap it.
  let zoomOsc = 0.7 + 0.3 * sin(t * 0.13);
  let pulse   = 1.0 - 0.22 * u.bass - 0.18 * beat;
  let camZoom = (zoomOsc * pulse * radius) / max(p.zoom.x, 0.1);

  let c = center + sampleUv * camZoom;

  let maxIter = u32(clamp(p.iterations.x, 16.0, 256.0));
  var z = vec2<f32>(0.0, 0.0);
  var smoothN: f32 = f32(maxIter);
  var escaped = false;
  for (var i: u32 = 0u; i < maxIter; i = i + 1u) {
    z = vec2<f32>(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    let mag2 = dot(z, z);
    if (mag2 > 256.0) {
      smoothN = f32(i) + 1.0 - log2(log2(mag2) * 0.5);
      escaped = true;
      break;
    }
  }

  let n = smoothN / f32(maxIter);

  var color: vec3<f32>;
  if (escaped) {
    let pal = 0.5 + 0.5 * cos(
      6.2831 * (vec3<f32>(0.0, 0.33, 0.66) + n * 1.6 + t * 0.05 + u.mid * 0.4)
    );
    color = pal * p.tint.xyz;
    // Boundary band brightens on the beat.
    let edge = exp(-pow(n - 0.78, 2.0) * 60.0);
    color = color + p.tint.xyz * edge * (0.35 + 1.4 * beat);
  } else {
    color = vec3<f32>(0.02, 0.01, 0.04) + p.tint.xyz * 0.05 * u.bass;
  }

  // Center glow flash on the beat.
  let r0 = length(uv);
  let flash = beat * (0.35 + u.peak * 0.6) * exp(-r0 * 1.4);
  color = color + p.tint.xyz * flash * 0.55;

  if (escaped) {
    let shimmer = 0.5 + 0.5 * sin(smoothN * 1.3 + t * 6.0);
    color = color + vec3<f32>(shimmer * u.treble * 0.08);
  }

  return vec4<f32>(color, 1.0);
}

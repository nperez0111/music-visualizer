// Burning Ship escape-time fractal:
//   z_{n+1} = (|Re z| + i|Im z|)^2 + c
// The abs-fold breaks the conformality of the ordinary Mandelbrot map and
// produces ship/antenna shapes with harsh diagonal flames. We tour a few
// well-known POIs and pulse the camera with audio.

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
};
@group(1) @binding(0) var<uniform> p: Params;

const TARGET_S : f32 = 24.0;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

// POI table for the Burning Ship.
//   .xy = c-plane center (note: y-axis is conventionally flipped in BS images;
//         we negate y inside fs_main to match common gallery framings).
//   .z  = view radius multiplier.
fn poi(idx: u32) -> vec3<f32> {
  if (idx == 0u) { return vec3<f32>(-0.50, -0.50, 1.50); }      // Full ship
  if (idx == 1u) { return vec3<f32>(-1.762, -0.028, 0.06); }    // Mini-ship "armada"
  if (idx == 2u) { return vec3<f32>(-1.62, -0.0035, 0.012); }   // Antenna detail
  return vec3<f32>(-1.7497, -0.0303, 0.005);                    // Deep filaments
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = vec2<f32>((pix.x - 0.5) * aspect, pix.y - 0.5) * 2.0;
  let t = u.time_ms * 0.001 * p.speed.x;

  let beat = pow(1.0 - u.beat_phase, 4.0);

  // POI cycle, same easing pattern as mandelbrot-pulse.
  let cycle = max(t, 0.0) / TARGET_S;
  let i0 = u32(floor(cycle)) % 4u;
  let i1 = (i0 + 1u) % 4u;
  let local = cycle - floor(cycle);
  let ease = smoothstep(0.82, 1.0, local);

  let pA = poi(i0);
  let pB = poi(i1);
  let centerBase = mix(pA.xy, pB.xy, ease);
  let radius = mix(pA.z, pB.z, ease);

  let wobble = vec2<f32>(
    0.10 * radius * sin(t * 0.19),
    0.08 * radius * cos(t * 0.23)
  );
  let center = centerBase + wobble;

  // Bass contracts the view, beats snap it.
  let zoomOsc = 0.7 + 0.3 * sin(t * 0.13);
  let pulse   = 1.0 - 0.22 * u.bass - 0.15 * beat;
  let camZoom = (zoomOsc * pulse * radius) / max(p.zoom.x, 0.1);

  // Burning Ship is conventionally rendered y-flipped; negate vertical.
  let sample = vec2<f32>(uv.x, -uv.y);
  let c = center + sample * camZoom;

  let maxIter = u32(clamp(p.iterations.x, 16.0, 384.0));
  var z = vec2<f32>(0.0, 0.0);
  var smoothN: f32 = f32(maxIter);
  var escaped = false;
  for (var i: u32 = 0u; i < maxIter; i = i + 1u) {
    // The abs-fold is what makes this the Burning Ship.
    let za = vec2<f32>(abs(z.x), abs(z.y));
    z = vec2<f32>(za.x * za.x - za.y * za.y, 2.0 * za.x * za.y) + c;
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
      6.2831 * (vec3<f32>(0.0, 0.20, 0.45) + n * 1.4 + t * 0.05 + u.mid * 0.4)
    );
    color = pal * p.tint.xyz;
    // Boundary band brightens on the beat.
    let edge = exp(-pow(n - 0.74, 2.0) * 70.0);
    color = color + p.tint.xyz * edge * (0.35 + 1.4 * beat);
    // Treble shimmer along filaments.
    let shimmer = 0.5 + 0.5 * sin(smoothN * 1.4 + t * 6.0);
    color = color + vec3<f32>(shimmer * u.treble * 0.08);
  } else {
    color = vec3<f32>(0.04, 0.018, 0.01) + p.tint.xyz * 0.05 * u.bass;
  }

  // Centerline glow flash on the beat.
  let r0 = length(uv);
  let flash = beat * (0.3 + u.peak * 0.55) * exp(-r0 * 1.2);
  color = color + p.tint.xyz * flash * 0.5;

  let vignette = smoothstep(1.7, 0.4, length(uv));
  color = color * vignette;

  return vec4<f32>(color, 1.0);
}

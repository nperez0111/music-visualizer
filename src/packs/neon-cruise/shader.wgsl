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
  pulse   : vec4<f32>,
  tint    : vec4<f32>,
  cycle   : vec4<f32>,
};
@group(1) @binding(0) var<uniform> p: Params;

// Camera: at origin, eye height EYE_H, looking +Z.
// Pinhole projection: sx = world.x * FOCAL / z, sy = (world.y - EYE_H) * FOCAL / z + HORIZON_Y.
// Aspect-corrected screen coords: sp.x in [-aspect, aspect], sp.y in [-1, +1].
const EYE_H        : f32 = 1.2;
const FOCAL        : f32 = 1.4;
const HORIZON_Y    : f32 = 0.06;
const ROAD_HALF_W  : f32 = 1.4;
const CELL_D       : f32 = 2.6;
const N_BUILDINGS  : u32 = 10u;
const LINE_THICK   : f32 = 0.0045;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn hash2(q: vec2<f32>) -> f32 {
  return fract(sin(dot(q, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn project(world: vec3<f32>) -> vec2<f32> {
  let z = max(world.z, 0.01);
  let sx = world.x * FOCAL / z;
  let sy = (world.y - EYE_H) * FOCAL / z + HORIZON_Y;
  return vec2<f32>(sx, sy);
}

// Distance from p to a rectangle's frame (border).
fn rectFrameDist(pt: vec2<f32>, lo: vec2<f32>, hi: vec2<f32>) -> f32 {
  let center = (lo + hi) * 0.5;
  let halfSize = abs(hi - lo) * 0.5;
  let q = abs(pt - center) - halfSize;
  let outside = length(max(q, vec2<f32>(0.0, 0.0)));
  let inside = min(max(q.x, q.y), 0.0);
  return abs(outside + inside);
}

// Distance to a line segment.
fn segDist(pt: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let pa = pt - a;
  let ba = b - a;
  let h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

// Distance to a circle's outline.
fn circleDist(pt: vec2<f32>, c: vec2<f32>, r: f32) -> f32 {
  return abs(length(pt - c) - r);
}

// Distance to the upper half of a circle's outline (wheel-arch).
fn upperArcDist(pt: vec2<f32>, c: vec2<f32>, r: f32) -> f32 {
  let d = pt - c;
  if (d.y >= 0.0) {
    return abs(length(d) - r);
  }
  let endL = vec2<f32>(c.x - r, c.y);
  let endR = vec2<f32>(c.x + r, c.y);
  return min(length(pt - endL), length(pt - endR));
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  // sp: aspect-corrected screen pos, y up.
  let sp = vec2<f32>((pix.x - 0.5) * 2.0 * aspect, (0.5 - pix.y) * 2.0);

  let t = u.time_ms * 0.001;
  let speedF = max(p.speed.x, 0.05);
  let scrollDist = t * (1.5 + speedF * 2.2);
  let firstIdF = floor(scrollDist / CELL_D);
  let firstId = i32(firstIdF);
  let scrollPhase = scrollDist - firstIdF * CELL_D;

  let beat = pow(1.0 - u.beat_phase, 4.0);
  let pulseAmt = p.pulse.x * (u.bass * 0.45 + beat * 0.65 + u.peak * 0.2);

  var minDist : f32 = 100.0;

  // ---- Buildings: front-face rectangle + 3 lines that form the visible top of the box. ----
  for (var i: u32 = 0u; i < N_BUILDINGS; i = i + 1u) {
    let apparentZ = f32(i + 1u) * CELL_D - scrollPhase;
    if (apparentZ < 0.6) { continue; }

    for (var sIdx: u32 = 0u; sIdx < 2u; sIdx = sIdx + 1u) {
      let side = f32(sIdx) * 2.0 - 1.0; // -1 left, +1 right
      let id = f32(firstId + i32(i));
      let h0 = hash2(vec2<f32>(id * 1.7, side * 3.1));
      let h1 = hash2(vec2<f32>(id * 0.91 + 11.0, side * 5.7));
      let h2 = hash2(vec2<f32>(id * 2.3 + 5.5, side * 1.9));

      let widthHalf = 0.45 + h1 * 0.45;
      let depthHalf = 0.4 + h2 * 0.3;
      let baseH = 0.7 + h0 * 2.9;
      let H = baseH * (1.0 + pulseAmt * (0.4 + h2 * 0.7));

      let cx = side * (ROAD_HALF_W + widthHalf + 0.15);
      let zFront = apparentZ - depthHalf;
      let zBack  = apparentZ + depthHalf;
      if (zFront < 0.4) { continue; }

      // Front-face corners (project to screen).
      let blF = project(vec3<f32>(cx - widthHalf, 0.0, zFront));
      let brF = project(vec3<f32>(cx + widthHalf, 0.0, zFront));
      let tlF = project(vec3<f32>(cx - widthHalf, H,   zFront));
      let trF = project(vec3<f32>(cx + widthHalf, H,   zFront));
      // Back corners.
      let blB = project(vec3<f32>(cx - widthHalf, 0.0, zBack));
      let brB = project(vec3<f32>(cx + widthHalf, 0.0, zBack));
      let tlB = project(vec3<f32>(cx - widthHalf, H,   zBack));
      let trB = project(vec3<f32>(cx + widthHalf, H,   zBack));

      let loF = vec2<f32>(min(blF.x, tlF.x), min(blF.y, brF.y));
      let hiF = vec2<f32>(max(brF.x, trF.x), max(tlF.y, trF.y));

      var dB = rectFrameDist(sp, loF, hiF);
      // Top depth lines (front-top to back-top, both sides).
      dB = min(dB, segDist(sp, tlF, tlB));
      dB = min(dB, segDist(sp, trF, trB));
      // Back-top edge.
      dB = min(dB, segDist(sp, tlB, trB));
      // Back vertical edges so each cube silhouette closes.
      dB = min(dB, segDist(sp, blB, tlB));
      dB = min(dB, segDist(sp, brB, trB));
      minDist = min(minDist, dB);
    }
  }

  // ---- Road edges: straight lines from screen bottom to vanishing point at (0, HORIZON_Y). ----
  // Derived from project: sy = HORIZON_Y - EYE_H * sx / world_x for points on the ground.
  if (sp.y < HORIZON_Y + 0.005) {
    if (sp.x > 0.0) {
      let syR = HORIZON_Y - EYE_H * sp.x / ROAD_HALF_W;
      minDist = min(minDist, abs(sp.y - syR));
    }
    if (sp.x < 0.0) {
      let syL = HORIZON_Y + EYE_H * sp.x / ROAD_HALF_W;
      minDist = min(minDist, abs(sp.y - syL));
    }

    // Center dashed line: invert-project to get ground depth, then dash on z.
    let zG = EYE_H * FOCAL / max(HORIZON_Y - sp.y, 1e-3);
    let dashPhase = fract((zG + scrollDist) * 0.55);
    let inDash = step(dashPhase, 0.5);
    let dCenter = abs(sp.x);
    let dCenterDashed = mix(100.0, dCenter, inDash);
    minDist = min(minDist, dCenterDashed);
  }

  // ---- Car silhouette (side view, sways left/right). ----
  let swerve =
      0.18 * sin(t * 0.5)
    + 0.06 * sin(t * 1.3 + u.bass * 2.0)
    + 0.04 * (u.peak - 0.5) * sin(t * 2.1);
  let carCenter = vec2<f32>(swerve, -0.58);
  // Body silhouette polyline: front bumper top → hood → cowl → windshield →
  // cabin roof → rear window → rear deck → trunk → rear bumper top.
  let pBumpFL  = carCenter + vec2<f32>(-0.40, -0.04);
  let pHoodF   = carCenter + vec2<f32>(-0.34,  0.01);
  let pCowl    = carCenter + vec2<f32>(-0.20,  0.04);
  let pWindT   = carCenter + vec2<f32>(-0.10,  0.16);
  let pRearWT  = carCenter + vec2<f32>( 0.10,  0.16);
  let pRearD   = carCenter + vec2<f32>( 0.20,  0.04);
  let pTrunk   = carCenter + vec2<f32>( 0.34,  0.01);
  let pBumpFR  = carCenter + vec2<f32>( 0.40, -0.04);
  var dCar = segDist(sp, pBumpFL, pHoodF);
  dCar = min(dCar, segDist(sp, pHoodF,  pCowl));
  dCar = min(dCar, segDist(sp, pCowl,   pWindT));
  dCar = min(dCar, segDist(sp, pWindT,  pRearWT));
  dCar = min(dCar, segDist(sp, pRearWT, pRearD));
  dCar = min(dCar, segDist(sp, pRearD,  pTrunk));
  dCar = min(dCar, segDist(sp, pTrunk,  pBumpFR));

  // Bumpers (vertical drops).
  let pBumpBL = carCenter + vec2<f32>(-0.40, -0.10);
  let pBumpBR = carCenter + vec2<f32>( 0.40, -0.10);
  dCar = min(dCar, segDist(sp, pBumpFL, pBumpBL));
  dCar = min(dCar, segDist(sp, pBumpFR, pBumpBR));

  // Lower skirt — 3 segments broken by wheel arches.
  dCar = min(dCar, segDist(sp, pBumpBL, carCenter + vec2<f32>(-0.34, -0.10)));
  dCar = min(dCar, segDist(sp, carCenter + vec2<f32>(-0.18, -0.10), carCenter + vec2<f32>( 0.18, -0.10)));
  dCar = min(dCar, segDist(sp, carCenter + vec2<f32>( 0.34, -0.10), pBumpBR));

  // Wheel arches (upper semicircles) and wheels.
  let wheelL = carCenter + vec2<f32>(-0.26, -0.10);
  let wheelR = carCenter + vec2<f32>( 0.26, -0.10);
  dCar = min(dCar, upperArcDist(sp, wheelL, 0.105));
  dCar = min(dCar, upperArcDist(sp, wheelR, 0.105));
  dCar = min(dCar, circleDist(sp, wheelL, 0.07));
  dCar = min(dCar, circleDist(sp, wheelR, 0.07));

  // B-pillar splitting the side windows.
  dCar = min(dCar, segDist(sp, carCenter + vec2<f32>(0.0, 0.04), carCenter + vec2<f32>(0.0, 0.16)));

  minDist = min(minDist, dCar);

  // ---- Compose ----
  let lineCore = smoothstep(LINE_THICK,        0.0,         minDist);
  let lineGlow = smoothstep(LINE_THICK * 5.0,  LINE_THICK,  minDist);

  // Sky gradient (very faint) for context.
  let skyMask = step(HORIZON_Y, sp.y);
  var color = vec3<f32>(0.0);
  color = color + vec3<f32>(0.005, 0.0, 0.025) * skyMask;
  color = color + vec3<f32>(0.012, 0.005, 0.02) * (1.0 - skyMask);

  // Tint shifts a touch with mid for variety.
  let baseTint = mix(p.tint.xyz, p.tint.zxy, u.mid * 0.15);
  // Optional time-cycle: drift toward a cosine-palette rainbow. 0 = off.
  let cycleAmt = clamp(p.cycle.x, 0.0, 1.5);
  let cyclePhase = t * (0.05 + cycleAmt * 0.12);
  let cycleTint = 0.5 + 0.5 * cos(6.2831 * (vec3<f32>(0.0, 0.33, 0.66) + cyclePhase));
  let tint = mix(baseTint, cycleTint, min(cycleAmt, 1.0));
  color = color + tint * (lineCore + lineGlow * 0.35);

  // Beat flash: briefly brighter lines and a tiny full-frame brightness lift.
  color = color * (1.0 + beat * 0.4 * p.pulse.x);
  color = color + tint * beat * 0.04 * p.pulse.x;

  // Treble shimmer along bright lines.
  color = color + vec3<f32>(lineCore * u.treble * 0.18);

  return vec4<f32>(color, 1.0);
}

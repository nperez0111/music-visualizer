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
const N_BUILDINGS  : u32 = 18u;
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

// Ray-casting edge test: returns 1 if a rightward ray from pt crosses
// the edge from a to b, 0 otherwise. Sum crossings: odd = inside polygon.
fn edgeCross(pt: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> i32 {
  if ((a.y <= pt.y && b.y > pt.y) || (b.y <= pt.y && a.y > pt.y)) {
    let tX = (pt.y - a.y) / (b.y - a.y);
    if (pt.x < a.x + tX * (b.x - a.x)) {
      return 1;
    }
  }
  return 0;
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

  // ---- Buildings: wireframe boxes with distance fade. ----
  let maxBuildZ = f32(N_BUILDINGS) * CELL_D;  // furthest building distance
  for (var i: u32 = 0u; i < N_BUILDINGS; i = i + 1u) {
    let apparentZ = f32(i + 1u) * CELL_D - scrollPhase;
    if (apparentZ < 0.6) { continue; }

    // Fade factor: buildings further than ~60% of max distance fade out linearly.
    let fadeStart = maxBuildZ * 0.55;
    let fadeFactor = clamp((maxBuildZ - apparentZ) / (maxBuildZ - fadeStart), 0.0, 1.0);
    if (fadeFactor < 0.01) { continue; }

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

      // Front face (4 edges of the projected trapezoid).
      var dB = segDist(sp, blF, brF);   // front bottom
      dB = min(dB, segDist(sp, brF, trF));   // front right
      dB = min(dB, segDist(sp, trF, tlF));   // front top
      dB = min(dB, segDist(sp, tlF, blF));   // front left
      // Top face (depth lines + back-top edge).
      dB = min(dB, segDist(sp, tlF, tlB));   // top-left depth
      dB = min(dB, segDist(sp, trF, trB));   // top-right depth
      dB = min(dB, segDist(sp, tlB, trB));   // back top
      // Back vertical edges.
      dB = min(dB, segDist(sp, blB, tlB));   // back left vertical
      dB = min(dB, segDist(sp, brB, trB));   // back right vertical
      // Bottom depth lines (close the box at ground level).
      dB = min(dB, segDist(sp, blF, blB));   // bottom-left depth
      dB = min(dB, segDist(sp, brF, brB));   // bottom-right depth
      // Back bottom edge.
      dB = min(dB, segDist(sp, blB, brB));   // back bottom

      // Inflate distance for far buildings so their lines fade out smoothly.
      let dFaded = dB + LINE_THICK * 6.0 * (1.0 - fadeFactor);
      minDist = min(minDist, dFaded);
    }
  }

  // ---- Car geometry (rear view — computed early for occlusion mask). ----
  let swerve =
      0.18 * sin(t * 0.5)
    + 0.06 * sin(t * 1.3 + u.bass * 2.0)
    + 0.04 * (u.peak - 0.5) * sin(t * 2.1);
  let carCenter = vec2<f32>(swerve, -0.58);

  // Body shell: trapezoidal rear profile.
  let bodyBL = carCenter + vec2<f32>(-0.32, -0.06);
  let bodyBR = carCenter + vec2<f32>( 0.32, -0.06);
  let bodyML = carCenter + vec2<f32>(-0.30,  0.06);
  let bodyMR = carCenter + vec2<f32>( 0.30,  0.06);
  let cabinBL = carCenter + vec2<f32>(-0.24,  0.06);
  let cabinBR = carCenter + vec2<f32>( 0.24,  0.06);
  let cabinTL = carCenter + vec2<f32>(-0.18,  0.20);
  let cabinTR = carCenter + vec2<f32>( 0.18,  0.20);
  let roofL = carCenter + vec2<f32>(-0.16,  0.22);
  let roofR = carCenter + vec2<f32>( 0.16,  0.22);
  let skirtY = carCenter.y - 0.10;
  let pSkirtBL = vec2<f32>(carCenter.x - 0.32, skirtY);
  let pSkirtBR = vec2<f32>(carCenter.x + 0.32, skirtY);

  // Car fill mask: ray-casting polygon test against the car's outer silhouette.
  // Vertices go clockwise: skirtBL -> bodyBL -> bodyML -> cabinBL -> cabinTL
  //   -> roofL -> roofR -> cabinTR -> cabinBR -> bodyMR -> bodyBR -> skirtBR.
  var crossings : i32 = 0;
  crossings = crossings + edgeCross(sp, pSkirtBL, bodyBL);
  crossings = crossings + edgeCross(sp, bodyBL,   bodyML);
  crossings = crossings + edgeCross(sp, bodyML,   cabinBL);
  crossings = crossings + edgeCross(sp, cabinBL,  cabinTL);
  crossings = crossings + edgeCross(sp, cabinTL,  roofL);
  crossings = crossings + edgeCross(sp, roofL,    roofR);
  crossings = crossings + edgeCross(sp, roofR,    cabinTR);
  crossings = crossings + edgeCross(sp, cabinTR,  cabinBR);
  crossings = crossings + edgeCross(sp, cabinBR,  bodyMR);
  crossings = crossings + edgeCross(sp, bodyMR,   bodyBR);
  crossings = crossings + edgeCross(sp, bodyBR,   pSkirtBR);
  crossings = crossings + edgeCross(sp, pSkirtBR, pSkirtBL);
  let insideCar = f32(crossings & 1);

  // ---- Road edges. ----
  var dRoad : f32 = 100.0;
  if (sp.y < HORIZON_Y + 0.005) {
    if (sp.x > 0.0) {
      let syR = HORIZON_Y - EYE_H * sp.x / ROAD_HALF_W;
      dRoad = min(dRoad, abs(sp.y - syR));
    }
    if (sp.x < 0.0) {
      let syL = HORIZON_Y + EYE_H * sp.x / ROAD_HALF_W;
      dRoad = min(dRoad, abs(sp.y - syL));
    }

    // Center dashed line.
    let zG = EYE_H * FOCAL / max(HORIZON_Y - sp.y, 1e-3);
    let dashPhase = fract((zG + scrollDist) * 0.55);
    let inDash = step(dashPhase, 0.5);
    let dCenter = abs(sp.x);
    let dCenterDashed = mix(100.0, dCenter, inDash);
    dRoad = min(dRoad, dCenterDashed);
  }
  minDist = min(minDist, dRoad);

  // ---- Car wireframe (drawn on top of everything). ----
  // Lower body outline (bumper + sides up to shoulder).
  var dCar = segDist(sp, bodyBL, bodyBR);             // bottom bumper edge
  dCar = min(dCar, segDist(sp, bodyBL,  bodyML));     // left side
  dCar = min(dCar, segDist(sp, bodyBR,  bodyMR));     // right side
  dCar = min(dCar, segDist(sp, bodyML,  cabinBL));    // left shoulder
  dCar = min(dCar, segDist(sp, bodyMR,  cabinBR));    // right shoulder
  // C-pillars and cabin.
  dCar = min(dCar, segDist(sp, cabinBL, cabinTL));    // left C-pillar
  dCar = min(dCar, segDist(sp, cabinBR, cabinTR));    // right C-pillar
  // Roof.
  dCar = min(dCar, segDist(sp, cabinTL, roofL));      // left roof edge
  dCar = min(dCar, segDist(sp, cabinTR, roofR));      // right roof edge
  dCar = min(dCar, segDist(sp, roofL,   roofR));      // roof top

  // Rear windshield (trapezoid inside cabin area).
  let rwBL = carCenter + vec2<f32>(-0.20,  0.08);
  let rwBR = carCenter + vec2<f32>( 0.20,  0.08);
  let rwTL = carCenter + vec2<f32>(-0.15,  0.19);
  let rwTR = carCenter + vec2<f32>( 0.15,  0.19);
  dCar = min(dCar, segDist(sp, rwBL, rwBR));
  dCar = min(dCar, segDist(sp, rwBL, rwTL));
  dCar = min(dCar, segDist(sp, rwBR, rwTR));
  dCar = min(dCar, segDist(sp, rwTL, rwTR));

  // Tail lights (small rectangles at shoulder height, each side).
  let tlW = 0.06;
  let tlH = 0.025;
  let tlY = carCenter.y + 0.035;
  let tlLx = carCenter.x - 0.255;
  let tlRx = carCenter.x + 0.255;
  dCar = min(dCar, rectFrameDist(sp,
    vec2<f32>(tlLx - tlW * 0.5, tlY - tlH), vec2<f32>(tlLx + tlW * 0.5, tlY + tlH)));
  dCar = min(dCar, rectFrameDist(sp,
    vec2<f32>(tlRx - tlW * 0.5, tlY - tlH), vec2<f32>(tlRx + tlW * 0.5, tlY + tlH)));

  // License plate (small rectangle, center bottom area).
  let lpW = 0.08;
  let lpH = 0.025;
  let lpY = carCenter.y - 0.02;
  dCar = min(dCar, rectFrameDist(sp,
    vec2<f32>(carCenter.x - lpW * 0.5, lpY - lpH), vec2<f32>(carCenter.x + lpW * 0.5, lpY + lpH)));

  // Lower skirt — 3 segments broken by wheel arches.
  dCar = min(dCar, segDist(sp, bodyBL, pSkirtBL));     // left drop to skirt
  dCar = min(dCar, segDist(sp, bodyBR, pSkirtBR));     // right drop to skirt
  dCar = min(dCar, segDist(sp, pSkirtBL, vec2<f32>(carCenter.x - 0.28, skirtY)));
  dCar = min(dCar, segDist(sp, vec2<f32>(carCenter.x - 0.14, skirtY), vec2<f32>(carCenter.x + 0.14, skirtY)));
  dCar = min(dCar, segDist(sp, vec2<f32>(carCenter.x + 0.28, skirtY), pSkirtBR));

  // Wheel arches (upper semicircles) and wheels.
  let wheelL = vec2<f32>(carCenter.x - 0.21, skirtY);
  let wheelR = vec2<f32>(carCenter.x + 0.21, skirtY);
  dCar = min(dCar, upperArcDist(sp, wheelL, 0.08));
  dCar = min(dCar, upperArcDist(sp, wheelR, 0.08));
  dCar = min(dCar, circleDist(sp, wheelL, 0.055));
  dCar = min(dCar, circleDist(sp, wheelR, 0.055));

  // ---- Compose ----
  // Background: sky / ground gradient.
  let skyMask = step(HORIZON_Y, sp.y);
  let bgColor = vec3<f32>(0.005, 0.0, 0.025) * skyMask
              + vec3<f32>(0.012, 0.005, 0.02) * (1.0 - skyMask);

  // Scene lines (buildings + road) — before car fill.
  let sceneCore = smoothstep(LINE_THICK,        0.0,         minDist);
  let sceneGlow = smoothstep(LINE_THICK * 5.0,  LINE_THICK,  minDist);

  // Tint shifts a touch with mid for variety.
  let baseTint = mix(p.tint.xyz, p.tint.zxy, u.mid * 0.15);
  // Optional time-cycle: drift toward a cosine-palette rainbow. 0 = off.
  let cycleAmt = clamp(p.cycle.x, 0.0, 1.5);
  let cyclePhase = t * (0.05 + cycleAmt * 0.12);
  let cycleTint = 0.5 + 0.5 * cos(6.2831 * (vec3<f32>(0.0, 0.33, 0.66) + cyclePhase));
  let tint = mix(baseTint, cycleTint, min(cycleAmt, 1.0));

  var color = bgColor + tint * (sceneCore + sceneGlow * 0.35);

  // Car fill: replace everything inside the car silhouette with background.
  color = mix(color, bgColor, insideCar);

  // Car wireframe: draw on top of the filled silhouette.
  let carCore = smoothstep(LINE_THICK,        0.0,         dCar);
  let carGlow = smoothstep(LINE_THICK * 5.0,  LINE_THICK,  dCar);
  color = color + tint * (carCore + carGlow * 0.35);

  // Beat flash: briefly brighter lines and a tiny full-frame brightness lift.
  color = color * (1.0 + beat * 0.4 * p.pulse.x);
  color = color + tint * beat * 0.04 * p.pulse.x;

  // Treble shimmer along bright lines.
  let totalCore = max(sceneCore * (1.0 - insideCar), carCore);
  color = color + vec3<f32>(totalCore * u.treble * 0.18);

  return vec4<f32>(color, 1.0);
}

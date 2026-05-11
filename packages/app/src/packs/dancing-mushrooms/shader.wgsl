// Dancing Mushrooms — kawaii anime toadstools bopping to the beat
// Tier 1 shader-only pack. SDF-based 2D cartoon rendering.
// Multiple mushrooms in a forest scene, each a parameterized instance.

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
  speed  : vec4<f32>,  // x = speed multiplier
  sway   : vec4<f32>,  // x = sway amount
  tint   : vec4<f32>,  // xyz = cap color
  squish : vec4<f32>,  // x = squish intensity
};
@group(1) @binding(0) var<uniform> p: Params;

// ─── Constants ───────────────────────────────────────────────────────

const PI : f32 = 3.14159265;
const OUTLINE_W : f32 = 0.008;
const GROUND_Y : f32 = -0.3;

// ─── SDF Primitives ──────────────────────────────────────────────────

fn sdCircle(pos: vec2<f32>, r: f32) -> f32 {
  return length(pos) - r;
}

fn sdEllipse(pos: vec2<f32>, ab: vec2<f32>) -> f32 {
  let q = abs(pos) / ab;
  return (length(q) - 1.0) * min(ab.x, ab.y);
}

fn sdTrapezoid(pos: vec2<f32>, topW: f32, botW: f32, h: f32) -> f32 {
  let p = vec2<f32>(abs(pos.x), pos.y);
  let yt = clamp(p.y / h, 0.0, 1.0);
  let w = mix(botW, topW, yt);
  let dx = p.x - w;
  let dy = abs(p.y - h * 0.5) - h * 0.5;
  let dxC = max(dx, 0.0);
  let dyC = max(dy, 0.0);
  return sqrt(dxC * dxC + dyC * dyC) + min(max(dx, dy), 0.0);
}

// ─── Rotation helper ─────────────────────────────────────────────────

fn rot2(a: f32) -> mat2x2<f32> {
  let c = cos(a);
  let s = sin(a);
  return mat2x2<f32>(c, s, -s, c);
}

// ─── Vertex shader (fullscreen triangle) ─────────────────────────────

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

// ─── Drawing helpers ─────────────────────────────────────────────────

fn fill(d: f32, s: f32) -> f32 {
  return 1.0 - smoothstep(0.0, 0.003 * s, d);
}

fn outlineRing(d: f32, w: f32, s: f32) -> f32 {
  return smoothstep(w + 0.003 * s, w, d) * (1.0 - smoothstep(0.0, 0.003 * s, d));
}

fn softFill(d: f32, softness: f32) -> f32 {
  return 1.0 - smoothstep(0.0, softness, d);
}

// ─── Hash / pseudo-random ────────────────────────────────────────────

fn hash1(n: f32) -> f32 {
  return fract(sin(n * 127.1) * 43758.5453);
}

fn hash2(n: f32) -> vec2<f32> {
  return vec2<f32>(hash1(n), hash1(n + 37.0));
}

// ─── Grass blade SDF ─────────────────────────────────────────────────
// A single blade: tapered triangle rooted at (0,0), growing upward.
// Returns the SDF distance. The blade bends sideways via a quadratic curve.

fn sdGrassBlade(pos: vec2<f32>, h: f32, w: f32, bend: f32) -> f32 {
  // Blade curves: x offset increases quadratically with height
  let t = clamp(pos.y / h, 0.0, 1.0);
  let curveX = bend * t * t;
  let p = vec2<f32>(pos.x - curveX, pos.y);
  // Taper: width goes from w at base to 0 at tip
  let halfW = w * 0.5 * (1.0 - t);
  let dx = abs(p.x) - halfW;
  let dy = abs(p.y - h * 0.5) - h * 0.5;
  let dxC = max(dx, 0.0);
  let dyC = max(dy, 0.0);
  return sqrt(dxC * dxC + dyC * dyC) + min(max(dx, dy), 0.0);
}

// ─── Grass field drawing ─────────────────────────────────────────────
// Draws many small grass blades along the ground line, swaying to the beat.

fn drawGrass(uv: vec2<f32>, colorIn: vec3<f32>, aspect: f32) -> vec3<f32> {
  // Only draw near ground level (skip if well above or below)
  if (uv.y > GROUND_Y + 0.12 || uv.y < GROUND_Y - 0.08) {
    return colorIn;
  }

  var color = colorIn;
  let t = u.time_ms * 0.001 * p.speed.x;

  // Scatter blades across the width of the screen
  let bladeCount = 60;
  let xRange = aspect + 0.1;  // cover full width with some margin

  for (var i = 0; i < bladeCount; i = i + 1) {
    let fi = f32(i);
    let rnd = hash2(fi * 7.3 + 1.5);

    // Blade position: spread across x, rooted at ground level
    let bladeX = -xRange + rnd.x * xRange * 2.0;
    let bladeRoot = vec2<f32>(bladeX, GROUND_Y);

    // Blade properties: randomized height, width, color
    let bladeH = 0.025 + rnd.y * 0.04;  // 0.025 to 0.065
    let bladeW = 0.004 + hash1(fi * 3.1) * 0.004;  // 0.004 to 0.008

    // Sway: each blade has its own phase, driven by bass + wind
    let bladePhase = fi * 2.39 + t * 1.8 + u.bass * 2.0;
    let baseSway = sin(bladePhase) * 0.02 * (0.5 + u.bass * 1.0);
    // Beat pop: blades bounce on the beat
    let beatPop = pow(1.0 - u.beat_phase, 4.0) * 0.01;
    let bladeBend = baseSway + beatPop * sin(fi * 1.7);

    // Transform to blade-local space
    let bp = uv - bladeRoot;
    let bladeSdf = sdGrassBlade(bp, bladeH, bladeW, bladeBend);

    // Color: vary between lighter and darker greens
    let greenMix = hash1(fi * 5.7 + 0.3);
    let grassLight = vec3<f32>(0.30, 0.58, 0.18);
    let grassDark  = vec3<f32>(0.18, 0.42, 0.10);
    let grassColor = mix(grassDark, grassLight, greenMix);

    let bladeFill = 1.0 - smoothstep(0.0, 0.002, bladeSdf);
    color = mix(color, grassColor, bladeFill);
  }

  return color;
}

// ─── Shadow-only pass ────────────────────────────────────────────────
// Draws just the ground shadow for one mushroom. Called for ALL mushrooms
// before any bodies, so shadows always sit behind all mushroom geometry.

fn drawShadow(
  uv: vec2<f32>,
  colorIn: vec3<f32>,
  basePos: vec2<f32>,
  scale: f32,
  phaseOff: f32,
) -> vec3<f32> {
  let t = u.time_ms * 0.001 * p.speed.x;
  let beat = pow(1.0 - u.beat_phase, 6.0);
  let squishAmt = p.squish.x * beat;
  let swayPhase = t * 2.5 + u.bass * 1.5 + phaseOff;
  let swayAngle = sin(swayPhase) * p.sway.x * 0.25 * (0.6 + u.bass * 0.8);

  let shadowWorldX = basePos.x + swayAngle * 0.1 * scale;
  let shadowP = uv - vec2<f32>(shadowWorldX, GROUND_Y - 0.01);
  let shadowW = (0.14 + squishAmt * 0.03) * scale;
  let shadowSdf = sdEllipse(shadowP, vec2<f32>(shadowW, 0.012 * scale));

  let shadowAlpha = softFill(shadowSdf, 0.04 * scale) * 0.3;
  return mix(colorIn, vec3<f32>(0.1, 0.15, 0.05), shadowAlpha);
}

// ─── Mushroom body drawing function ──────────────────────────────────
// Draws stem, cap, spots, and face. No shadow — that's drawn separately.
//
//   uv        — world-space fragment coordinate (centered, Y-up)
//   colorIn   — current pixel color to composite onto
//   basePos   — mushroom base position (x, y). y should be below GROUND_Y
//               so the stem root is hidden underground.
//   scale     — uniform scale (1.0 = default size)
//   phaseOff  — phase offset for sway/bob so each mushroom dances differently

fn drawMushroomBody(
  uv: vec2<f32>,
  colorIn: vec3<f32>,
  basePos: vec2<f32>,
  scale: f32,
  phaseOff: f32,
) -> vec3<f32> {
  var color = colorIn;

  let t = u.time_ms * 0.001 * p.speed.x;
  let invScale = 1.0 / scale;

  // ─── Audio-derived animation ──────────────────────────────────
  let beat = pow(1.0 - u.beat_phase, 6.0);
  let swayAmt = p.sway.x * 0.25;
  let squishAmt = p.squish.x * beat;

  let swayPhase = t * 2.5 + u.bass * 1.5 + phaseOff;
  let swayAngle = sin(swayPhase) * swayAmt * (0.6 + u.bass * 0.8);

  // ─── Local coordinate space ───────────────────────────────────
  var mp = (uv - basePos) * invScale;
  let groundLocal = (GROUND_Y - basePos.y) * invScale;
  let heightAboveGround = max(mp.y - groundLocal, 0.0);
  let maxLeanHeight = 0.35;
  let leanT = clamp(heightAboveGround / maxLeanHeight, 0.0, 1.0);
  let leanOffset = swayAngle * leanT * leanT * 0.35;

  let bobRaw = 1.0 - u.beat_phase;
  let bobWave = bobRaw * bobRaw;

  // ─── Stem geometry ────────────────────────────────────────────
  let stemH : f32 = 0.32;
  let stemTopW : f32 = 0.048;
  let stemBotW : f32 = 0.062;

  let bendFreq = 3.5;
  let bendPhase = t * 3.0 + phaseOff * 0.7;
  let bendStrength = 0.015 * (0.5 + u.mid * 1.0) * p.sway.x;

  let bobFull = bobWave * 0.1 * p.squish.x;

  var sp = mp;
  let stemBobT = clamp(sp.y / stemH, 0.0, 1.0);
  sp.y = sp.y - bobFull * stemBobT;
  let stemLeanT = clamp(sp.y / stemH, 0.0, 1.0);
  sp.x = sp.x - leanOffset * stemLeanT;
  let bendOffset = sin(stemLeanT * PI * bendFreq + bendPhase) * bendStrength * stemLeanT;
  sp.x = sp.x - bendOffset;

  let stemSdfRaw = sdTrapezoid(sp, stemTopW, stemBotW, stemH);
  let stemTopEffective = stemH + bobFull;
  let stemTopClip = mp.y - stemTopEffective;
  let stemSdf = max(stemSdfRaw, stemTopClip);

  // ─── Cap geometry ─────────────────────────────────────────────
  let capBendX = sin(1.0 * PI * bendFreq + bendPhase) * bendStrength * 1.0;
  let capRadX = 0.19 * (1.0 + squishAmt * 0.2);
  let capRadY = 0.105 * (1.0 - squishAmt * 0.15);
  let capRad = vec2<f32>(capRadX, capRadY);

  let capCenterY = stemTopEffective + capRadY * 0.35;
  let capCenter = vec2<f32>(capBendX + leanOffset, capCenterY);

  var cp = mp - capCenter;
  cp = rot2(-swayAngle * 0.2) * cp;

  let capSdf = sdEllipse(cp, capRad);
  let capBottomClip = -cp.y - capRadY * 0.15;
  let capDome = max(capSdf, capBottomClip);

  let undersideP = cp + vec2<f32>(0.0, capRadY * 0.1);
  let undersideSdf = sdEllipse(undersideP, vec2<f32>(capRadX * 0.92, capRadY * 0.25));
  let undersideClip = cp.y + capRadY * 0.15;
  let undersideFinal = max(undersideSdf, undersideClip);

  // ─── White spots ──────────────────────────────────────────────
  let spot1 = sdCircle(cp - vec2<f32>(-0.10,  0.015), 0.024);
  let spot2 = sdCircle(cp - vec2<f32>(-0.04,  0.06),  0.022);
  let spot3 = sdCircle(cp - vec2<f32>( 0.025, 0.072), 0.017);
  let spot4 = sdCircle(cp - vec2<f32>( 0.08,  0.035), 0.025);
  let spot5 = sdCircle(cp - vec2<f32>( 0.0,   0.035), 0.014);
  let spot6 = sdCircle(cp - vec2<f32>( 0.13,  0.005), 0.015);
  let spotSdf = min(min(min(min(min(spot1, spot2), spot3), spot4), spot5), spot6);

  // ─── Kawaii face ──────────────────────────────────────────────
  let faceY = stemH * 0.62;
  let faceLeanT = clamp(faceY / stemH, 0.0, 1.0);
  let faceBendX = sin(faceLeanT * PI * bendFreq + bendPhase) * bendStrength * faceLeanT;
  let faceLeanX = leanOffset * faceLeanT;
  let faceBob = bobFull * faceLeanT;
  let faceCenter = vec2<f32>(faceBendX + faceLeanX, faceY + faceBob);
  let fp = mp - faceCenter;

  let eyeSpacing = 0.030;
  let eyeRadius = 0.018;
  let eyeHighlightR = 0.007;
  let eyeHighlightOff = vec2<f32>(0.005, 0.006);

  let blinkAmount = smoothstep(0.3, 0.8, beat * u.peak * 2.0);
  let eyeSquishY = mix(1.0, 0.15, blinkAmount);

  var leftEyeP = fp - vec2<f32>(-eyeSpacing, 0.0);
  leftEyeP.y = leftEyeP.y / eyeSquishY;
  let leftEye = sdCircle(leftEyeP, eyeRadius);
  let leftHighlight = sdCircle(fp - vec2<f32>(-eyeSpacing, 0.0) - eyeHighlightOff, eyeHighlightR);

  var rightEyeP = fp - vec2<f32>(eyeSpacing, 0.0);
  rightEyeP.y = rightEyeP.y / eyeSquishY;
  let rightEye = sdCircle(rightEyeP, eyeRadius);
  let rightHighlight = sdCircle(fp - vec2<f32>(eyeSpacing, 0.0) - eyeHighlightOff, eyeHighlightR);

  let eyesSdf = min(leftEye, rightEye);
  let highlightsSdf = min(leftHighlight, rightHighlight);

  let mouthY = -0.022;
  let mouthRadius : f32 = 0.014;
  let mouthP = fp - vec2<f32>(0.0, mouthY);
  let mouthCircle = abs(length(mouthP) - mouthRadius) - 0.0025;
  let mouthClip = mouthP.y;
  let mouthSdf = max(mouthCircle, mouthClip);

  let blushR = 0.018;
  let blushSpacing = 0.048;
  let blushY = -0.012;
  let leftBlush = sdCircle(fp - vec2<f32>(-blushSpacing, blushY), blushR);
  let rightBlush = sdCircle(fp - vec2<f32>(blushSpacing, blushY), blushR);
  let blushSdf = min(leftBlush, rightBlush);

  // ─── Early-out: skip compositing if fragment is far from mushroom ─
  let worldCapCenter = basePos + capCenter * scale;
  let boundDist = length(uv - worldCapCenter);
  let boundR = (capRadX + stemH + 0.15) * scale;
  if (boundDist > boundR) {
    return color;
  }

  // ─── Compositing (back to front) ──────────────────────────────

  let ow = OUTLINE_W;

  // Colors
  let outlineColor = vec3<f32>(0.15, 0.1, 0.08);
  let stemColor = vec3<f32>(0.95, 0.90, 0.82);
  let stemShadowColor = vec3<f32>(0.85, 0.78, 0.68);
  let capColor = p.tint.xyz;
  let capDarkColor = p.tint.xyz * 0.6;
  let capLightColor = p.tint.xyz * 1.2 + vec3<f32>(0.1, 0.05, 0.05);
  let spotColor = vec3<f32>(1.0, 1.0, 0.97);
  let blushColor = vec3<f32>(1.0, 0.55, 0.6);

  // Stem outline
  let stemOutline = outlineRing(stemSdf, ow, 1.0);
  color = mix(color, outlineColor, stemOutline);

  // Stem fill
  let stemFill = fill(stemSdf, 1.0);
  let stemShade = smoothstep(stemBotW, 0.0, abs(sp.x)) * 0.3 + 0.7;
  let stemFinalColor = mix(stemShadowColor, stemColor, stemShade);
  color = mix(color, stemFinalColor, stemFill);

  // Cap underside
  let undersideOutline = outlineRing(undersideFinal, ow * 0.7, 1.0);
  color = mix(color, outlineColor, undersideOutline * 0.5);
  let undersideFill = fill(undersideFinal, 1.0);
  color = mix(color, capDarkColor, undersideFill);

  // Cap dome
  let capOutline = outlineRing(capDome, ow, 1.0);
  color = mix(color, outlineColor, capOutline);
  let capFill = fill(capDome, 1.0);
  let capHighlight = smoothstep(0.1, -0.05, cp.x + cp.y * 0.5);
  let capShaded = mix(capColor, capLightColor, capHighlight * 0.4);
  color = mix(color, capShaded, capFill);

  // White spots
  let spotFill = fill(spotSdf, 1.0) * capFill;
  color = mix(color, spotColor, spotFill);

  // Blush
  let blushAlpha = softFill(blushSdf, 0.015) * 0.45 * stemFill;
  color = mix(color, blushColor, blushAlpha);

  // Eyes
  let eyesFill = fill(eyesSdf, 1.0) * stemFill;
  color = mix(color, vec3<f32>(0.08, 0.06, 0.06), eyesFill);

  // Eye highlights
  let highlightFill = fill(highlightsSdf, 1.0) * eyesFill;
  let sparkle = 0.7 + u.treble * 0.5;
  color = mix(color, vec3<f32>(sparkle), highlightFill);

  // Mouth
  let mouthFill = fill(mouthSdf, 1.0) * stemFill;
  color = mix(color, vec3<f32>(0.12, 0.08, 0.08), mouthFill);

  return color;
}

// ─── Fragment shader ─────────────────────────────────────────────────

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  var uv = (pix - vec2<f32>(0.5, 0.5)) * vec2<f32>(aspect, -1.0);

  // ─── Background ──────────────────────────────────────────────────
  let skyTop = vec3<f32>(0.45, 0.65, 0.92);
  let skyBot = vec3<f32>(0.72, 0.85, 0.95);
  let groundTop = vec3<f32>(0.35, 0.62, 0.22);
  let groundBot = vec3<f32>(0.22, 0.45, 0.12);

  let skyMix = smoothstep(-0.5, 0.5, uv.y);
  var sky = mix(skyBot, skyTop, skyMix);
  sky = sky * (0.95 + u.rms * 0.15);

  let groundMix = smoothstep(-0.6, GROUND_Y, uv.y);
  let ground = mix(groundBot, groundTop, groundMix);

  let isGround = 1.0 - smoothstep(GROUND_Y - 0.005, GROUND_Y + 0.005, uv.y);
  var color = mix(sky, ground, isGround);

  // ─── Layer 1: ALL shadows (behind everything) ─────────────────────
  // Back row
  color = drawShadow(uv, color, vec2<f32>(-0.30, GROUND_Y - 0.09), 0.40, 1.2);
  color = drawShadow(uv, color, vec2<f32>( 0.25, GROUND_Y - 0.09), 0.38, 3.8);
  color = drawShadow(uv, color, vec2<f32>( 0.68, GROUND_Y - 0.09), 0.35, 5.0);
  // Middle row
  color = drawShadow(uv, color, vec2<f32>(-0.55, GROUND_Y - 0.10), 0.55, 0.7);
  color = drawShadow(uv, color, vec2<f32>(-0.05, GROUND_Y - 0.10), 0.58, 4.2);
  color = drawShadow(uv, color, vec2<f32>( 0.48, GROUND_Y - 0.10), 0.52, 2.5);
  // Front row
  color = drawShadow(uv, color, vec2<f32>(-0.42, GROUND_Y - 0.12), 0.80, 2.0);
  color = drawShadow(uv, color, vec2<f32>( 0.0,  GROUND_Y - 0.12), 1.0,  0.0);
  color = drawShadow(uv, color, vec2<f32>( 0.45, GROUND_Y - 0.12), 0.85, 5.5);

  // ─── Layer 2: Grass blades (on top of shadows, behind mushrooms) ──
  color = drawGrass(uv, color, aspect);

  // ─── Layer 3: Mushroom bodies (back to front) ────────────────────
  // Back row (small, distant-feeling)
  color = drawMushroomBody(uv, color, vec2<f32>(-0.30, GROUND_Y - 0.09), 0.40, 1.2);
  color = drawMushroomBody(uv, color, vec2<f32>( 0.25, GROUND_Y - 0.09), 0.38, 3.8);
  color = drawMushroomBody(uv, color, vec2<f32>( 0.68, GROUND_Y - 0.09), 0.35, 5.0);

  // Middle row
  color = drawMushroomBody(uv, color, vec2<f32>(-0.55, GROUND_Y - 0.10), 0.55, 0.7);
  color = drawMushroomBody(uv, color, vec2<f32>(-0.05, GROUND_Y - 0.10), 0.58, 4.2);
  color = drawMushroomBody(uv, color, vec2<f32>( 0.48, GROUND_Y - 0.10), 0.52, 2.5);

  // Front row — hero center with two flanking
  color = drawMushroomBody(uv, color, vec2<f32>(-0.42, GROUND_Y - 0.12), 0.80, 2.0);
  color = drawMushroomBody(uv, color, vec2<f32>( 0.0,  GROUND_Y - 0.12), 1.0,  0.0);
  color = drawMushroomBody(uv, color, vec2<f32>( 0.45, GROUND_Y - 0.12), 0.85, 5.5);

  // ─── Final adjustments ───────────────────────────────────────────
  let vigUV = pix * 2.0 - vec2<f32>(1.0, 1.0);
  let vig = smoothstep(1.5, 0.6, length(vigUV));
  color = color * (0.7 + 0.3 * vig);

  return vec4<f32>(color, 1.0);
}

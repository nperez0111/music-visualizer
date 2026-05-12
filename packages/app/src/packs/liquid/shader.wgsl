
// Fullscreen triangle vertex shader (auto-generated)
@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, -y, 0.0, 1.0);
}

struct Uniforms {
    time_ms: f32,
    delta_ms: f32,
    resolution: vec2<f32>,
    rms: f32,
    peak: f32,
    bass: f32,
    mid: f32,
    treble: f32,
    bpm: f32,
    beat_phase: f32,
    _pad: f32,
    spectrum: array<vec4<f32>, 8>,
}

struct Params {
    level: vec4<f32>,
    viscosity: vec4<f32>,
    refraction: vec4<f32>,
    foam: vec4<f32>,
    tint: vec4<f32>,
}

struct FragmentOutput {
    @location(0) _fragColor: vec4<f32>,
}

@group(0) @binding(0) 
var<uniform> _cn_u: Uniforms;
@group(1) @binding(0) 
var<uniform> _cn_p: Params;
var<private> _fragColor: vec4<f32>;
var<private> gl_FragCoord_1: vec4<f32>;

fn rotX(a: f32) -> mat3x3<f32> {
    var a_1: f32;
    var c: f32;
    var s: f32;

    a_1 = a;
    let _e36 = a_1;
    c = cos(_e36);
    let _e39 = a_1;
    s = sin(_e39);
    let _e46 = c;
    let _e47 = s;
    let _e50 = s;
    let _e51 = c;
    return mat3x3<f32>(vec3<f32>(1f, 0f, 0f), vec3<f32>(0f, _e46, -(_e47)), vec3<f32>(0f, _e50, _e51));
}

fn rotZ(a_2: f32) -> mat3x3<f32> {
    var a_3: f32;
    var c_1: f32;
    var s_1: f32;

    a_3 = a_2;
    let _e36 = a_3;
    c_1 = cos(_e36);
    let _e39 = a_3;
    s_1 = sin(_e39);
    let _e42 = c_1;
    let _e43 = s_1;
    let _e46 = s_1;
    let _e47 = c_1;
    return mat3x3<f32>(vec3<f32>(_e42, -(_e43), 0f), vec3<f32>(_e46, _e47, 0f), vec3<f32>(0f, 0f, 1f));
}

fn sdRoundedCylinder(p: vec3<f32>, ra: f32, rb: f32, h: f32) -> f32 {
    var p_1: vec3<f32>;
    var ra_1: f32;
    var rb_1: f32;
    var h_1: f32;
    var d: vec2<f32>;

    p_1 = p;
    ra_1 = ra;
    rb_1 = rb;
    h_1 = h;
    let _e42 = p_1;
    let _e45 = ra_1;
    let _e47 = rb_1;
    let _e49 = p_1;
    let _e52 = h_1;
    d = vec2<f32>(((length(_e42.xz) - _e45) + _e47), (abs(_e49.y) - _e52));
    let _e56 = d;
    let _e58 = d;
    let _e63 = d;
    let _e69 = rb_1;
    return ((min(max(_e56.x, _e58.y), 0f) + length(max(_e63, vec2(0f)))) - _e69);
}

fn sdGlass(p_2: vec3<f32>, outerR: f32, height: f32, wall: f32, rnd: f32) -> f32 {
    var p_3: vec3<f32>;
    var outerR_1: f32;
    var height_1: f32;
    var wall_1: f32;
    var rnd_1: f32;
    var outer: f32;
    var pi: vec3<f32>;
    var inner: f32;

    p_3 = p_2;
    outerR_1 = outerR;
    height_1 = height;
    wall_1 = wall;
    rnd_1 = rnd;
    let _e44 = p_3;
    let _e45 = outerR_1;
    let _e46 = rnd_1;
    let _e47 = height_1;
    let _e48 = sdRoundedCylinder(_e44, _e45, _e46, _e47);
    outer = _e48;
    let _e50 = p_3;
    pi = _e50;
    let _e53 = pi;
    let _e55 = wall_1;
    pi.y = (_e53.y - (_e55 * 0.5f));
    let _e59 = pi;
    let _e60 = outerR_1;
    let _e61 = wall_1;
    let _e63 = rnd_1;
    let _e66 = height_1;
    let _e67 = wall_1;
    let _e71 = sdRoundedCylinder(_e59, (_e60 - _e61), (_e63 * 0.5f), (_e66 - (_e67 * 0.5f)));
    inner = _e71;
    let _e73 = outer;
    let _e74 = inner;
    return max(_e73, -(_e74));
}

fn sdInterior(p_4: vec3<f32>, outerR_2: f32, height_2: f32, wall_2: f32, rnd_2: f32) -> f32 {
    var p_5: vec3<f32>;
    var outerR_3: f32;
    var height_3: f32;
    var wall_3: f32;
    var rnd_3: f32;
    var pi_1: vec3<f32>;

    p_5 = p_4;
    outerR_3 = outerR_2;
    height_3 = height_2;
    wall_3 = wall_2;
    rnd_3 = rnd_2;
    let _e44 = p_5;
    pi_1 = _e44;
    let _e47 = pi_1;
    let _e49 = wall_3;
    pi_1.y = (_e47.y - (_e49 * 0.5f));
    let _e53 = pi_1;
    let _e54 = outerR_3;
    let _e55 = wall_3;
    let _e57 = rnd_3;
    let _e60 = height_3;
    let _e61 = wall_3;
    let _e65 = sdRoundedCylinder(_e53, (_e54 - _e55), (_e57 * 0.5f), (_e60 - (_e61 * 0.5f)));
    return _e65;
}

fn sdOuterOnly(p_6: vec3<f32>, outerR_4: f32, height_4: f32, rnd_4: f32) -> f32 {
    var p_7: vec3<f32>;
    var outerR_5: f32;
    var height_5: f32;
    var rnd_5: f32;

    p_7 = p_6;
    outerR_5 = outerR_4;
    height_5 = height_4;
    rnd_5 = rnd_4;
    let _e42 = p_7;
    let _e43 = outerR_5;
    let _e44 = rnd_5;
    let _e45 = height_5;
    let _e46 = sdRoundedCylinder(_e42, _e43, _e44, _e45);
    return _e46;
}

fn liquidSurface(xz: vec2<f32>, baseH: f32, rockAngle: f32, rockPhase: f32, agitation: f32, visc: f32, t: f32) -> f32 {
    var xz_1: vec2<f32>;
    var baseH_1: f32;
    var rockAngle_1: f32;
    var rockPhase_1: f32;
    var agitation_1: f32;
    var visc_1: f32;
    var t_1: f32;
    var damp: f32;
    var h_2: f32;
    var slosh: f32;
    var dist: f32;
    var w1_: f32;
    var w2_: f32;
    var w3_: f32;
    var w4_: f32;

    xz_1 = xz;
    baseH_1 = baseH;
    rockAngle_1 = rockAngle;
    rockPhase_1 = rockPhase;
    agitation_1 = agitation;
    visc_1 = visc;
    t_1 = t;
    let _e50 = visc_1;
    damp = mix(1f, 0.2f, _e50);
    let _e53 = baseH_1;
    h_2 = _e53;
    let _e55 = rockAngle_1;
    let _e58 = damp;
    slosh = ((_e55 * 1.4f) * _e58);
    let _e61 = h_2;
    let _e62 = slosh;
    let _e63 = rockPhase_1;
    let _e65 = xz_1;
    let _e68 = rockPhase_1;
    let _e70 = xz_1;
    h_2 = (_e61 - (_e62 * ((cos(_e63) * _e65.x) + (sin(_e68) * _e70.y))));
    let _e76 = xz_1;
    dist = length(_e76);
    let _e79 = xz_1;
    let _e83 = t_1;
    let _e86 = damp;
    let _e90 = xz_1;
    let _e94 = t_1;
    let _e97 = damp;
    w1_ = ((sin(((_e79.x * 3f) + ((_e83 * 0.5f) * _e86))) * cos(((_e90.y * 2.5f) + ((_e94 * 0.4f) * _e97)))) * 0.035f);
    let _e105 = xz_1;
    let _e109 = t_1;
    let _e112 = damp;
    let _e115 = xz_1;
    w2_ = (sin((((_e105.x * 6.5f) - ((_e109 * 0.8f) * _e112)) + (_e115.y * 4.5f))) * 0.012f);
    let _e124 = dist;
    let _e127 = t_1;
    let _e130 = damp;
    w3_ = (sin(((_e124 * 9f) - ((_e127 * 0.9f) * _e130))) * 0.008f);
    let _e137 = dist;
    let _e140 = t_1;
    let _e145 = agitation_1;
    let _e149 = damp;
    w4_ = (((sin(((_e137 * 5f) - (_e140 * 1.4f))) * _e145) * 0.05f) * _e149);
    let _e152 = h_2;
    let _e153 = w1_;
    let _e154 = w2_;
    let _e156 = w3_;
    let _e158 = w4_;
    let _e161 = agitation_1;
    h_2 = (_e152 + ((((_e153 + _e154) + _e156) + _e158) * (0.2f + (_e161 * 0.8f))));
    let _e167 = h_2;
    return _e167;
}

fn liquidNormal(xz_2: vec2<f32>, baseH_2: f32, rockAngle_2: f32, rockPhase_2: f32, agitation_2: f32, visc_2: f32, t_2: f32) -> vec3<f32> {
    var xz_3: vec2<f32>;
    var baseH_3: f32;
    var rockAngle_3: f32;
    var rockPhase_3: f32;
    var agitation_3: f32;
    var visc_3: f32;
    var t_3: f32;
    var e: f32 = 0.004f;
    var hc: f32;
    var hx: f32;
    var hz: f32;

    xz_3 = xz_2;
    baseH_3 = baseH_2;
    rockAngle_3 = rockAngle_2;
    rockPhase_3 = rockPhase_2;
    agitation_3 = agitation_2;
    visc_3 = visc_2;
    t_3 = t_2;
    let _e50 = xz_3;
    let _e51 = baseH_3;
    let _e52 = rockAngle_3;
    let _e53 = rockPhase_3;
    let _e54 = agitation_3;
    let _e55 = visc_3;
    let _e56 = t_3;
    let _e57 = liquidSurface(_e50, _e51, _e52, _e53, _e54, _e55, _e56);
    hc = _e57;
    let _e59 = xz_3;
    let _e60 = e;
    let _e64 = baseH_3;
    let _e65 = rockAngle_3;
    let _e66 = rockPhase_3;
    let _e67 = agitation_3;
    let _e68 = visc_3;
    let _e69 = t_3;
    let _e70 = liquidSurface((_e59 + vec2<f32>(_e60, 0f)), _e64, _e65, _e66, _e67, _e68, _e69);
    hx = _e70;
    let _e72 = xz_3;
    let _e74 = e;
    let _e77 = baseH_3;
    let _e78 = rockAngle_3;
    let _e79 = rockPhase_3;
    let _e80 = agitation_3;
    let _e81 = visc_3;
    let _e82 = t_3;
    let _e83 = liquidSurface((_e72 + vec2<f32>(0f, _e74)), _e77, _e78, _e79, _e80, _e81, _e82);
    hz = _e83;
    let _e85 = hc;
    let _e86 = hx;
    let _e88 = e;
    let _e89 = hc;
    let _e90 = hz;
    return normalize(vec3<f32>((_e85 - _e86), _e88, (_e89 - _e90)));
}

fn calcNormal(p_8: vec3<f32>, oR: f32, h_3: f32, w: f32, r: f32) -> vec3<f32> {
    var p_9: vec3<f32>;
    var oR_1: f32;
    var h_4: f32;
    var w_1: f32;
    var r_1: f32;
    var e_1: vec2<f32> = vec2<f32>(0.0008f, 0f);

    p_9 = p_8;
    oR_1 = oR;
    h_4 = h_3;
    w_1 = w;
    r_1 = r;
    let _e48 = p_9;
    let _e49 = e_1;
    let _e52 = oR_1;
    let _e53 = h_4;
    let _e54 = w_1;
    let _e55 = r_1;
    let _e56 = sdGlass((_e48 + _e49.xyy), _e52, _e53, _e54, _e55);
    let _e57 = p_9;
    let _e58 = e_1;
    let _e61 = oR_1;
    let _e62 = h_4;
    let _e63 = w_1;
    let _e64 = r_1;
    let _e65 = sdGlass((_e57 - _e58.xyy), _e61, _e62, _e63, _e64);
    let _e67 = p_9;
    let _e68 = e_1;
    let _e71 = oR_1;
    let _e72 = h_4;
    let _e73 = w_1;
    let _e74 = r_1;
    let _e75 = sdGlass((_e67 + _e68.yxy), _e71, _e72, _e73, _e74);
    let _e76 = p_9;
    let _e77 = e_1;
    let _e80 = oR_1;
    let _e81 = h_4;
    let _e82 = w_1;
    let _e83 = r_1;
    let _e84 = sdGlass((_e76 - _e77.yxy), _e80, _e81, _e82, _e83);
    let _e86 = p_9;
    let _e87 = e_1;
    let _e90 = oR_1;
    let _e91 = h_4;
    let _e92 = w_1;
    let _e93 = r_1;
    let _e94 = sdGlass((_e86 + _e87.yyx), _e90, _e91, _e92, _e93);
    let _e95 = p_9;
    let _e96 = e_1;
    let _e99 = oR_1;
    let _e100 = h_4;
    let _e101 = w_1;
    let _e102 = r_1;
    let _e103 = sdGlass((_e95 - _e96.yyx), _e99, _e100, _e101, _e102);
    return normalize(vec3<f32>((_e56 - _e65), (_e75 - _e84), (_e94 - _e103)));
}

fn envMap(dir: vec3<f32>, t_4: f32) -> vec3<f32> {
    var dir_1: vec3<f32>;
    var t_5: f32;
    var y: f32;
    var sky: vec3<f32>;
    var sun1_: f32;
    var sun2_: f32;
    var sun3_: f32;
    var swirl: f32;

    dir_1 = dir;
    t_5 = t_4;
    let _e38 = dir_1;
    y = ((_e38.y * 0.5f) + 0.5f);
    let _e53 = y;
    sky = mix(vec3<f32>(0.08f, 0.04f, 0.18f), vec3<f32>(0.02f, 0.01f, 0.06f), vec3(_e53));
    let _e57 = dir_1;
    sun1_ = pow(max(dot(_e57, vec3<f32>(0.70710677f, 0.56568545f, 0.4242641f)), 0f), 16f);
    let _e73 = dir_1;
    sun2_ = pow(max(dot(_e73, vec3<f32>(-0.70352644f, 0.5025189f, -0.5025189f)), 0f), 12f);
    let _e91 = dir_1;
    sun3_ = pow(max(dot(_e91, vec3<f32>(0f, -0.28734788f, 0.95782626f)), 0f), 8f);
    let _e108 = sky;
    let _e113 = sun1_;
    sky = (_e108 + ((vec3<f32>(0.8f, 0.6f, 0.3f) * _e113) * 0.4f));
    let _e118 = sky;
    let _e123 = sun2_;
    sky = (_e118 + ((vec3<f32>(0.3f, 0.4f, 0.8f) * _e123) * 0.25f));
    let _e128 = sky;
    let _e133 = sun3_;
    sky = (_e128 + ((vec3<f32>(0.5f, 0.3f, 0.6f) * _e133) * 0.15f));
    let _e138 = dir_1;
    let _e142 = dir_1;
    let _e147 = t_5;
    let _e152 = dir_1;
    let _e156 = t_5;
    swirl = (((sin((((_e138.x * 4f) + (_e142.y * 3f)) + (_e147 * 0.12f))) * cos(((_e152.z * 3.5f) - (_e156 * 0.08f)))) * 0.5f) + 0.5f);
    let _e167 = sky;
    let _e172 = swirl;
    sky = (_e167 + (vec3<f32>(0.06f, 0.03f, 0.1f) * _e172));
    let _e175 = sky;
    return _e175;
}

fn background(uv: vec2<f32>, t_6: f32) -> vec3<f32> {
    var uv_1: vec2<f32>;
    var t_7: f32;
    var dir_2: vec3<f32>;

    uv_1 = uv;
    t_7 = t_6;
    let _e38 = uv_1;
    dir_2 = normalize(vec3<f32>(_e38.x, _e38.y, -0.8f));
    let _e46 = dir_2;
    let _e47 = t_7;
    let _e48 = envMap(_e46, _e47);
    return _e48;
}

fn fresnel(V: vec3<f32>, N: vec3<f32>, f0_: f32) -> f32 {
    var V_1: vec3<f32>;
    var N_1: vec3<f32>;
    var f0_1: f32;
    var d_1: f32;

    V_1 = V;
    N_1 = N;
    f0_1 = f0_;
    let _e41 = V_1;
    let _e42 = N_1;
    d_1 = clamp((1f - dot(_e41, _e42)), 0f, 1f);
    let _e49 = f0_1;
    let _e51 = f0_1;
    let _e53 = d_1;
    let _e55 = d_1;
    let _e57 = d_1;
    let _e59 = d_1;
    let _e61 = d_1;
    return (_e49 + ((((((1f - _e51) * _e53) * _e55) * _e57) * _e59) * _e61));
}

fn glassAO(p_10: vec3<f32>, n: vec3<f32>, oR_2: f32, h_5: f32, w_2: f32, r_2: f32) -> f32 {
    var p_11: vec3<f32>;
    var n_1: vec3<f32>;
    var oR_3: f32;
    var h_6: f32;
    var w_3: f32;
    var r_3: f32;
    var ao: f32 = 0f;
    var scale: f32 = 1f;
    var i: i32 = 0i;
    var dist_1: f32;
    var d_2: f32;

    p_11 = p_10;
    n_1 = n;
    oR_3 = oR_2;
    h_6 = h_5;
    w_3 = w_2;
    r_3 = r_2;
    loop {
        let _e52 = i;
        if !((_e52 < 4i)) {
            break;
        }
        {
            let _e61 = i;
            dist_1 = (0.02f + (0.06f * f32(_e61)));
            let _e66 = p_11;
            let _e67 = n_1;
            let _e68 = dist_1;
            let _e71 = oR_3;
            let _e72 = h_6;
            let _e73 = w_3;
            let _e74 = r_3;
            let _e75 = sdGlass((_e66 + (_e67 * _e68)), _e71, _e72, _e73, _e74);
            d_2 = _e75;
            let _e77 = ao;
            let _e78 = dist_1;
            let _e79 = d_2;
            let _e81 = scale;
            ao = (_e77 + ((_e78 - _e79) * _e81));
            let _e84 = scale;
            scale = (_e84 * 0.6f);
        }
        continuing {
            let _e56 = i;
            i = (_e56 + 1i);
        }
    }
    let _e88 = ao;
    return clamp((1f - (_e88 * 3f)), 0f, 1f);
}

fn mainImage(fragColor: ptr<function, vec4<f32>>, fragCoord: vec2<f32>) {
    var fragCoord_1: vec2<f32>;
    var uv_2: vec2<f32>;
    var t_8: f32;
    var baseLevel: f32;
    var visc_4: f32;
    var refStr: f32;
    var foamAmt: f32;
    var liqColor: vec3<f32>;
    var specShift: f32;
    var agitation_4: f32;
    var beatPulse: f32;
    var damp_1: f32;
    var swayX: f32;
    var swayY: f32;
    var rockZ: f32;
    var rockX: f32;
    var bRot: mat3x3<f32>;
    var invRot: mat3x3<f32>;
    var bCenter: vec3<f32>;
    var oR_4: f32 = 0.35f;
    var gH: f32 = 0.5f;
    var wall_4: f32 = 0.025f;
    var rnd_6: f32 = 0.035f;
    var light1_: vec3<f32> = vec3<f32>(0.44112876f, 0.7352146f, 0.5146502f);
    var light2_: vec3<f32> = vec3<f32>(-0.5698029f, 0.68376344f, -0.4558423f);
    var light1Col: vec3<f32> = vec3<f32>(1f, 0.95f, 0.85f);
    var light2Col: vec3<f32> = vec3<f32>(0.5f, 0.6f, 0.9f);
    var ro: vec3<f32> = vec3<f32>(0f, 0.05f, 2.4f);
    var rd: vec3<f32>;
    var bgCol: vec3<f32>;
    var d_3: f32 = 0f;
    var hitGlass: bool = false;
    var hitB: vec3<f32> = vec3(0f);
    var i_1: i32 = 0i;
    var pW: vec3<f32>;
    var pB: vec3<f32>;
    var dist_2: f32;
    var hitW: vec3<f32>;
    var nB: vec3<f32>;
    var nW: vec3<f32>;
    var ao_1: f32;
    var fres: f32;
    var reflDir: vec3<f32>;
    var envRefl: vec3<f32>;
    var spec1_: f32;
    var spec2_: f32;
    var glassSpec: vec3<f32>;
    var diff1_: f32;
    var diff2_: f32;
    var glassDiff: vec3<f32>;
    var rockAngle_4: f32;
    var rockPhase_4: f32;
    var refractRay: vec3<f32>;
    var refractOffset: vec2<f32>;
    var interiorStart: f32;
    var stepSize: f32;
    var marchT: f32;
    var hitLiquid: bool = false;
    var liquidHitW: vec3<f32> = vec3(0f);
    var liquidDepth: f32 = 0f;
    var i_2: i32 = 0i;
    var pW_1: vec3<f32>;
    var pB_1: vec3<f32>;
    var interior: f32;
    var surfH: f32;
    var lo: f32;
    var hi: f32;
    var b: i32;
    var mid: f32;
    var mp: vec3<f32>;
    var mh: f32;
    var j: i32;
    var pB2_: vec3<f32>;
    var throughCol: vec3<f32>;
    var lNorm: vec3<f32>;
    var liqRefract: vec3<f32>;
    var refUV: vec2<f32>;
    var refractedBg: vec3<f32>;
    var absorption: f32;
    var deepColor: vec3<f32>;
    var absorbColor: vec3<f32>;
    var sss: f32;
    var lRefl: vec3<f32>;
    var lSpec1_: f32;
    var lSpec2_: f32;
    var lFres: f32;
    var surfH_1: f32;
    var surfDist: f32;
    var foamMask: f32;
    var fn_: f32;
    var foamColor: vec3<f32>;
    var refUV_1: vec2<f32>;
    var glassTint: vec3<f32> = vec3<f32>(0.97f, 0.99f, 1f);
    var col: vec3<f32>;
    var edgeDark: f32;
    var rim: f32;
    var topRimB: vec3<f32>;
    var atTop: f32;
    var rimRing: f32;

    fragCoord_1 = fragCoord;
    let _e37 = fragCoord_1;
    let _e39 = _cn_u.resolution;
    let _e47 = _cn_u.resolution;
    uv_2 = ((_e37 - (0.5f * vec3<f32>(_e39.x, _e39.y, 1f).xy)) / vec2(vec3<f32>(_e47.x, _e47.y, 1f).y));
    let _e56 = _cn_u.time_ms;
    t_8 = (_e56 / 1000f);
    let _e60 = _cn_p.level;
    baseLevel = ((_e60.x * 1f) - 0.5f);
    let _e67 = _cn_p.viscosity;
    visc_4 = _e67.x;
    let _e70 = _cn_p.refraction;
    refStr = _e70.x;
    let _e73 = _cn_p.foam;
    foamAmt = _e73.x;
    let _e76 = _cn_p.tint;
    liqColor = _e76.xyz;
    let _e79 = _cn_u.mid;
    let _e82 = _cn_u.treble;
    specShift = ((_e79 * 0.3f) + (_e82 * 0.2f));
    let _e87 = liqColor;
    let _e88 = liqColor;
    let _e90 = specShift;
    liqColor = mix(_e87, _e88.yzx, vec3((_e90 * 0.35f)));
    let _e95 = _cn_u.bass;
    let _e98 = _cn_u.peak;
    let _e102 = _cn_u.rms;
    agitation_4 = (((_e95 * 0.5f) + (_e98 * 0.3f)) + (_e102 * 0.2f));
    let _e108 = _cn_u.beat_phase;
    beatPulse = pow((1f - _e108), 4f);
    let _e113 = agitation_4;
    let _e114 = beatPulse;
    agitation_4 = (_e113 + (_e114 * 0.4f));
    let _e118 = agitation_4;
    agitation_4 = clamp(_e118, 0f, 1f);
    let _e124 = visc_4;
    damp_1 = mix(1f, 0.2f, _e124);
    let _e128 = agitation_4;
    let _e132 = t_8;
    let _e137 = damp_1;
    let _e139 = agitation_4;
    let _e142 = t_8;
    let _e149 = damp_1;
    swayX = ((((0.18f + (_e128 * 0.35f)) * sin((_e132 * 0.55f))) * _e137) + (((_e139 * 0.12f) * sin(((_e142 * 1f) + 0.5f))) * _e149));
    let _e154 = agitation_4;
    let _e158 = t_8;
    let _e165 = damp_1;
    swayY = (((0.03f + (_e154 * 0.06f)) * sin(((_e158 * 0.4f) + 1.3f))) * _e165);
    let _e169 = agitation_4;
    let _e173 = t_8;
    let _e178 = damp_1;
    let _e180 = agitation_4;
    let _e183 = t_8;
    let _e188 = damp_1;
    rockZ = ((((0.12f + (_e169 * 0.22f)) * sin((_e173 * 0.55f))) * _e178) + (((_e180 * 0.1f) * sin((_e183 * 1f))) * _e188));
    let _e193 = agitation_4;
    let _e197 = t_8;
    let _e204 = damp_1;
    rockX = (((0.04f + (_e193 * 0.08f)) * sin(((_e197 * 0.4f) + 1.3f))) * _e204);
    let _e207 = rockZ;
    let _e208 = rotZ(_e207);
    let _e209 = rockX;
    let _e210 = rotX(_e209);
    bRot = (_e208 * _e210);
    let _e213 = bRot;
    invRot = transpose(_e213);
    let _e216 = swayX;
    let _e217 = swayY;
    bCenter = vec3<f32>(_e216, _e217, 0f);
    let _e266 = uv_2;
    rd = normalize(vec3<f32>(_e266.x, _e266.y, -1f));
    let _e274 = uv_2;
    let _e275 = t_8;
    let _e276 = background(_e274, _e275);
    bgCol = _e276;
    loop {
        let _e287 = i_1;
        if !((_e287 < 90i)) {
            break;
        }
        {
            let _e294 = ro;
            let _e295 = rd;
            let _e296 = d_3;
            pW = (_e294 + (_e295 * _e296));
            let _e300 = invRot;
            let _e301 = pW;
            let _e302 = bCenter;
            pB = (_e300 * (_e301 - _e302));
            let _e306 = pB;
            let _e307 = oR_4;
            let _e308 = gH;
            let _e309 = wall_4;
            let _e310 = rnd_6;
            let _e311 = sdGlass(_e306, _e307, _e308, _e309, _e310);
            dist_2 = _e311;
            let _e313 = dist_2;
            if (_e313 < 0.0008f) {
                {
                    hitGlass = true;
                    let _e317 = pB;
                    hitB = _e317;
                    break;
                }
            }
            let _e318 = d_3;
            if (_e318 > 6f) {
                break;
            }
            let _e321 = d_3;
            let _e322 = dist_2;
            d_3 = (_e321 + _e322);
        }
        continuing {
            let _e291 = i_1;
            i_1 = (_e291 + 1i);
        }
    }
    let _e324 = hitGlass;
    if !(_e324) {
        {
            let _e326 = bgCol;
            (*fragColor) = vec4<f32>(_e326.x, _e326.y, _e326.z, 1f);
            return;
        }
    }
    let _e332 = ro;
    let _e333 = rd;
    let _e334 = d_3;
    hitW = (_e332 + (_e333 * _e334));
    let _e338 = hitB;
    let _e339 = oR_4;
    let _e340 = gH;
    let _e341 = wall_4;
    let _e342 = rnd_6;
    let _e343 = calcNormal(_e338, _e339, _e340, _e341, _e342);
    nB = _e343;
    let _e345 = bRot;
    let _e346 = nB;
    nW = (_e345 * _e346);
    let _e349 = hitB;
    let _e350 = nB;
    let _e351 = oR_4;
    let _e352 = gH;
    let _e353 = wall_4;
    let _e354 = rnd_6;
    let _e355 = glassAO(_e349, _e350, _e351, _e352, _e353, _e354);
    ao_1 = _e355;
    let _e357 = rd;
    let _e359 = nW;
    let _e361 = fresnel(-(_e357), _e359, 0.04f);
    fres = _e361;
    let _e363 = rd;
    let _e364 = nW;
    reflDir = reflect(_e363, _e364);
    let _e367 = reflDir;
    let _e368 = t_8;
    let _e369 = envMap(_e367, _e368);
    envRefl = _e369;
    let _e371 = envRefl;
    let _e372 = beatPulse;
    let _e375 = liqColor;
    envRefl = (_e371 + ((_e372 * 0.08f) * _e375));
    let _e378 = reflDir;
    let _e379 = light1_;
    spec1_ = pow(max(dot(_e378, _e379), 0f), 64f);
    let _e386 = reflDir;
    let _e387 = light2_;
    spec2_ = pow(max(dot(_e386, _e387), 0f), 48f);
    let _e394 = light1Col;
    let _e395 = spec1_;
    let _e399 = light2Col;
    let _e400 = spec2_;
    glassSpec = (((_e394 * _e395) * 0.7f) + ((_e399 * _e400) * 0.4f));
    let _e406 = nW;
    let _e407 = light1_;
    diff1_ = max(dot(_e406, _e407), 0f);
    let _e412 = nW;
    let _e413 = light2_;
    diff2_ = max(dot(_e412, _e413), 0f);
    let _e418 = light1Col;
    let _e419 = diff1_;
    let _e421 = light2Col;
    let _e422 = diff2_;
    glassDiff = (((_e418 * _e419) + ((_e421 * _e422) * 0.5f)) * 0.06f);
    let _e430 = rockZ;
    let _e431 = rockX;
    rockAngle_4 = length(vec2<f32>(_e430, _e431));
    let _e435 = rockX;
    let _e436 = rockZ;
    rockPhase_4 = atan2(_e435, _e436);
    let _e439 = rd;
    let _e440 = nW;
    refractRay = refract(_e439, _e440, 0.6666667f);
    let _e446 = refractRay;
    if (length(_e446) < 0.01f) {
        let _e450 = rd;
        refractRay = _e450;
    }
    let _e451 = refractRay;
    let _e453 = rd;
    refractOffset = (_e451.xz - _e453.xz);
    let _e457 = d_3;
    let _e458 = wall_4;
    interiorStart = (_e457 + (_e458 * 2f));
    let _e463 = gH;
    stepSize = ((_e463 * 2f) / 64f);
    let _e469 = interiorStart;
    marchT = _e469;
    loop {
        let _e480 = i_2;
        if !((_e480 < 64i)) {
            break;
        }
        {
            let _e487 = ro;
            let _e488 = rd;
            let _e489 = marchT;
            pW_1 = (_e487 + (_e488 * _e489));
            let _e493 = invRot;
            let _e494 = pW_1;
            let _e495 = bCenter;
            pB_1 = (_e493 * (_e494 - _e495));
            let _e499 = pB_1;
            let _e500 = oR_4;
            let _e501 = gH;
            let _e502 = wall_4;
            let _e503 = rnd_6;
            let _e504 = sdInterior(_e499, _e500, _e501, _e502, _e503);
            interior = _e504;
            let _e506 = interior;
            if (_e506 > 0.04f) {
                break;
            }
            let _e509 = pW_1;
            let _e511 = baseLevel;
            let _e512 = bCenter;
            let _e515 = rockAngle_4;
            let _e516 = rockPhase_4;
            let _e517 = agitation_4;
            let _e518 = visc_4;
            let _e519 = t_8;
            let _e520 = liquidSurface(_e509.xz, (_e511 + _e512.y), _e515, _e516, _e517, _e518, _e519);
            surfH = _e520;
            let _e522 = pW_1;
            let _e524 = surfH;
            if (_e522.y > _e524) {
                {
                    let _e526 = marchT;
                    let _e527 = stepSize;
                    lo = (_e526 - _e527);
                    let _e530 = marchT;
                    hi = _e530;
                    b = 0i;
                    loop {
                        let _e534 = b;
                        if !((_e534 < 8i)) {
                            break;
                        }
                        {
                            let _e541 = lo;
                            let _e542 = hi;
                            mid = ((_e541 + _e542) * 0.5f);
                            let _e547 = ro;
                            let _e548 = rd;
                            let _e549 = mid;
                            mp = (_e547 + (_e548 * _e549));
                            let _e553 = mp;
                            let _e555 = baseLevel;
                            let _e556 = bCenter;
                            let _e559 = rockAngle_4;
                            let _e560 = rockPhase_4;
                            let _e561 = agitation_4;
                            let _e562 = visc_4;
                            let _e563 = t_8;
                            let _e564 = liquidSurface(_e553.xz, (_e555 + _e556.y), _e559, _e560, _e561, _e562, _e563);
                            mh = _e564;
                            let _e566 = mp;
                            let _e568 = mh;
                            if (_e566.y > _e568) {
                                {
                                    let _e570 = mid;
                                    hi = _e570;
                                }
                            } else {
                                {
                                    let _e571 = mid;
                                    lo = _e571;
                                }
                            }
                        }
                        continuing {
                            let _e538 = b;
                            b = (_e538 + 1i);
                        }
                    }
                    let _e572 = hi;
                    marchT = _e572;
                    hitLiquid = true;
                    let _e574 = ro;
                    let _e575 = rd;
                    let _e576 = marchT;
                    liquidHitW = (_e574 + (_e575 * _e576));
                    j = 0i;
                    loop {
                        let _e581 = j;
                        if !((_e581 < 16i)) {
                            break;
                        }
                        {
                            let _e588 = marchT;
                            let _e589 = stepSize;
                            marchT = (_e588 + _e589);
                            let _e591 = invRot;
                            let _e592 = ro;
                            let _e593 = rd;
                            let _e594 = marchT;
                            let _e597 = bCenter;
                            pB2_ = (_e591 * ((_e592 + (_e593 * _e594)) - _e597));
                            let _e601 = pB2_;
                            let _e602 = oR_4;
                            let _e603 = gH;
                            let _e604 = wall_4;
                            let _e605 = rnd_6;
                            let _e606 = sdInterior(_e601, _e602, _e603, _e604, _e605);
                            if (_e606 > 0f) {
                                break;
                            }
                            let _e609 = liquidDepth;
                            let _e610 = stepSize;
                            liquidDepth = (_e609 + _e610);
                        }
                        continuing {
                            let _e585 = j;
                            j = (_e585 + 1i);
                        }
                    }
                    break;
                }
            }
            let _e612 = marchT;
            let _e613 = stepSize;
            marchT = (_e612 + _e613);
        }
        continuing {
            let _e484 = i_2;
            i_2 = (_e484 + 1i);
        }
    }
    let _e616 = hitLiquid;
    if _e616 {
        {
            let _e617 = liquidHitW;
            let _e619 = baseLevel;
            let _e620 = bCenter;
            let _e623 = rockAngle_4;
            let _e624 = rockPhase_4;
            let _e625 = agitation_4;
            let _e626 = visc_4;
            let _e627 = t_8;
            let _e628 = liquidNormal(_e617.xz, (_e619 + _e620.y), _e623, _e624, _e625, _e626, _e627);
            lNorm = _e628;
            let _e630 = rd;
            let _e631 = lNorm;
            liqRefract = refract(_e630, _e631, 0.7518797f);
            let _e637 = liqRefract;
            if (length(_e637) < 0.01f) {
                let _e641 = rd;
                liqRefract = _e641;
            }
            let _e642 = uv_2;
            let _e643 = liqRefract;
            let _e645 = refractOffset;
            let _e647 = refStr;
            refUV = (_e642 + (((_e643.xz + _e645) * _e647) * 0.3f));
            let _e653 = refUV;
            let _e654 = t_8;
            let _e655 = background(_e653, _e654);
            refractedBg = _e655;
            let _e658 = liquidDepth;
            absorption = (1f - exp((-(_e658) * 5f)));
            let _e665 = liqColor;
            let _e666 = liqColor;
            deepColor = ((_e665 * _e666) * 1.5f);
            let _e671 = liqColor;
            let _e672 = deepColor;
            let _e673 = absorption;
            absorbColor = mix(_e671, _e672, vec3((_e673 * 0.6f)));
            let _e679 = absorbColor;
            let _e682 = absorption;
            absorbColor = (_e679 * (0.7f + (0.3f * _e682)));
            let _e686 = refractedBg;
            let _e689 = absorbColor;
            let _e690 = absorption;
            throughCol = mix((_e686 * 0.3f), _e689, vec3(((_e690 * 0.75f) + 0.25f)));
            let _e697 = rd;
            let _e698 = light1_;
            let _e704 = absorption;
            sss = (pow(max(dot(_e697, _e698), 0f), 3f) * _e704);
            let _e707 = throughCol;
            let _e708 = liqColor;
            let _e709 = sss;
            throughCol = (_e707 + ((_e708 * _e709) * 0.2f));
            let _e714 = light1_;
            let _e716 = lNorm;
            lRefl = reflect(-(_e714), _e716);
            let _e719 = lRefl;
            let _e720 = rd;
            lSpec1_ = pow(max(dot(_e719, -(_e720)), 0f), 48f);
            let _e728 = light2_;
            let _e730 = lNorm;
            lRefl = reflect(-(_e728), _e730);
            let _e732 = lRefl;
            let _e733 = rd;
            lSpec2_ = pow(max(dot(_e732, -(_e733)), 0f), 32f);
            let _e741 = throughCol;
            let _e742 = light1Col;
            let _e743 = lSpec1_;
            let _e747 = light2Col;
            let _e748 = lSpec2_;
            throughCol = (_e741 + (((_e742 * _e743) * 0.45f) + ((_e747 * _e748) * 0.25f)));
            let _e754 = rd;
            let _e756 = lNorm;
            let _e758 = fresnel(-(_e754), _e756, 0.02f);
            lFres = _e758;
            let _e760 = throughCol;
            let _e761 = envRefl;
            let _e764 = lFres;
            throughCol = mix(_e760, (_e761 * 0.5f), vec3((_e764 * 0.2f)));
            let _e769 = liquidHitW;
            let _e771 = baseLevel;
            let _e772 = bCenter;
            let _e775 = rockAngle_4;
            let _e776 = rockPhase_4;
            let _e777 = agitation_4;
            let _e778 = visc_4;
            let _e779 = t_8;
            let _e780 = liquidSurface(_e769.xz, (_e771 + _e772.y), _e775, _e776, _e777, _e778, _e779);
            surfH_1 = _e780;
            let _e782 = liquidHitW;
            let _e784 = surfH_1;
            surfDist = abs((_e782.y - _e784));
            let _e790 = surfDist;
            let _e792 = foamAmt;
            foamMask = (smoothstep(0.035f, 0f, _e790) * _e792);
            let _e795 = foamMask;
            let _e797 = agitation_4;
            foamMask = (_e795 * (0.3f + (_e797 * 0.7f)));
            let _e804 = liquidHitW;
            let _e808 = t_8;
            let _e814 = liquidHitW;
            let _e818 = t_8;
            fn_ = (0.5f + ((0.5f * sin(((_e804.x * 14f) + (_e808 * 0.4f)))) * cos(((_e814.z * 12f) - (_e818 * 0.3f)))));
            let _e826 = fn_;
            let _e829 = liquidHitW;
            let _e834 = t_8;
            fn_ = (_e826 * (0.6f + (0.4f * sin(((length(_e829.xz) * 10f) + (_e834 * 0.5f))))));
            let _e842 = foamMask;
            let _e843 = fn_;
            let _e845 = _cn_u.treble;
            foamMask = (_e842 * (_e843 * (0.5f + (_e845 * 0.5f))));
            let _e855 = liqColor;
            foamColor = mix(vec3<f32>(1f, 0.98f, 0.95f), ((_e855 * 1.3f) + vec3(0.4f)), vec3(0.25f));
            let _e865 = throughCol;
            let _e866 = foamColor;
            let _e867 = foamMask;
            throughCol = mix(_e865, _e866, vec3(clamp(_e867, 0f, 0.55f)));
        }
    } else {
        {
            let _e873 = uv_2;
            let _e874 = refractOffset;
            let _e875 = refStr;
            refUV_1 = (_e873 + ((_e874 * _e875) * 0.15f));
            let _e881 = refUV_1;
            let _e882 = t_8;
            let _e883 = background(_e881, _e882);
            throughCol = _e883;
        }
    }
    let _e889 = throughCol;
    let _e890 = glassTint;
    col = (_e889 * _e890);
    let _e894 = rd;
    let _e896 = nW;
    edgeDark = pow((1f - abs(dot(-(_e894), _e896))), 1.5f);
    let _e903 = col;
    let _e905 = edgeDark;
    col = (_e903 * (1f - (_e905 * 0.3f)));
    let _e910 = col;
    let _e911 = glassSpec;
    col = (_e910 + _e911);
    let _e913 = col;
    let _e914 = envRefl;
    let _e915 = fres;
    col = mix(_e913, _e914, vec3((_e915 * 0.4f)));
    let _e920 = col;
    let _e921 = glassDiff;
    let _e922 = ao_1;
    col = (_e920 + (_e921 * _e922));
    let _e926 = rd;
    let _e928 = nW;
    rim = pow((1f - abs(dot(-(_e926), _e928))), 4f);
    let _e935 = col;
    let _e940 = rim;
    let _e942 = ao_1;
    col = (_e935 + ((vec3<f32>(0.2f, 0.22f, 0.28f) * _e940) * _e942));
    let _e945 = hitB;
    topRimB = _e945;
    let _e947 = gH;
    let _e950 = gH;
    let _e953 = topRimB;
    atTop = smoothstep((_e947 - 0.02f), (_e950 + 0.01f), _e953.y);
    let _e957 = atTop;
    let _e958 = oR_4;
    let _e959 = wall_4;
    let _e963 = oR_4;
    let _e964 = wall_4;
    let _e968 = topRimB;
    rimRing = (_e957 * smoothstep(((_e958 - _e959) - 0.01f), ((_e963 - _e964) + 0.01f), length(_e968.xz)));
    let _e974 = col;
    let _e979 = rimRing;
    col = (_e974 + ((vec3<f32>(0.3f, 0.32f, 0.35f) * _e979) * 0.5f));
    let _e984 = col;
    let _e985 = liqColor;
    let _e986 = beatPulse;
    col = (_e984 + ((_e985 * _e986) * 0.04f));
    let _e991 = col;
    let _e992 = col;
    col = (_e991 / (_e992 + vec3(0.8f)));
    let _e997 = col;
    col = pow(_e997, vec3(0.92f));
    let _e1001 = col;
    (*fragColor) = vec4<f32>(_e1001.x, _e1001.y, _e1001.z, 1f);
    return;
}

fn main_1() {
    var _fc: vec2<f32>;
    var local: vec4<f32>;

    let _e36 = gl_FragCoord_1;
    let _e38 = _cn_u.resolution;
    let _e40 = gl_FragCoord_1;
    _fc = vec2<f32>(_e36.x, (_e38.y - _e40.y));
    let _e46 = _fc;
    mainImage((&local), _e46);
    let _e49 = local;
    _fragColor = _e49;
    return;
}

@fragment 
fn fs_main(@builtin(position) gl_FragCoord: vec4<f32>) -> FragmentOutput {
    gl_FragCoord_1 = gl_FragCoord;
    main_1();
    let _e39 = _fragColor;
    return FragmentOutput(_e39);
}

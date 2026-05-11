
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
var<uniform> u: Uniforms;
@group(1) @binding(0) 
var<uniform> p: Params;
var<private> _fragColor: vec4<f32>;
var<private> gl_FragCoord_1: vec4<f32>;

fn sdSphere(p: vec3<f32>, r: f32) -> f32 {
    var p_1: vec3<f32>;
    var r_1: f32;

    p_1 = p;
    r_1 = r;
    let _e38 = p_1;
    let _e40 = r_1;
    return (length(_e38) - _e40);
}

fn liquidSurface(xz: vec2<f32>, baseLevel: f32, sloshAngle: f32, sloshDir: f32, agitation: f32, visc: f32, t: f32) -> f32 {
    var xz_1: vec2<f32>;
    var baseLevel_1: f32;
    var sloshAngle_1: f32;
    var sloshDir_1: f32;
    var agitation_1: f32;
    var visc_1: f32;
    var t_1: f32;
    var damping: f32;
    var h: f32;
    var tilt: f32;
    var wave1_: f32;
    var wave2_: f32;
    var dist: f32;
    var wave3_: f32;
    var wave4_: f32;

    xz_1 = xz;
    baseLevel_1 = baseLevel;
    sloshAngle_1 = sloshAngle;
    sloshDir_1 = sloshDir;
    agitation_1 = agitation;
    visc_1 = visc;
    t_1 = t;
    let _e50 = visc_1;
    damping = mix(1f, 0.15f, _e50);
    let _e53 = baseLevel_1;
    h = ((_e53 * 2f) - 1f);
    let _e59 = sloshAngle_1;
    let _e61 = damping;
    tilt = ((sin(_e59) * _e61) * 0.45f);
    let _e66 = h;
    let _e67 = tilt;
    let _e68 = sloshDir_1;
    let _e70 = xz_1;
    let _e73 = sloshDir_1;
    let _e75 = xz_1;
    h = (_e66 + (_e67 * ((cos(_e68) * _e70.x) + (sin(_e73) * _e75.y))));
    let _e81 = xz_1;
    let _e85 = t_1;
    let _e88 = damping;
    let _e92 = xz_1;
    let _e96 = t_1;
    let _e99 = damping;
    wave1_ = ((sin(((_e81.x * 3f) + ((_e85 * 2f) * _e88))) * cos(((_e92.y * 2.5f) + ((_e96 * 1.7f) * _e99)))) * 0.08f);
    let _e107 = xz_1;
    let _e111 = t_1;
    let _e114 = damping;
    let _e117 = xz_1;
    wave2_ = (sin((((_e107.x * 7f) - ((_e111 * 3.5f) * _e114)) + (_e117.y * 5f))) * 0.035f);
    let _e126 = xz_1;
    dist = length(_e126);
    let _e129 = dist;
    let _e132 = t_1;
    let _e135 = damping;
    wave3_ = (sin(((_e129 * 10f) - ((_e132 * 4f) * _e135))) * 0.025f);
    let _e142 = dist;
    let _e145 = t_1;
    let _e150 = agitation_1;
    let _e154 = damping;
    wave4_ = (((sin(((_e142 * 6f) - (_e145 * 6f))) * _e150) * 0.12f) * _e154);
    let _e157 = h;
    let _e158 = wave1_;
    let _e159 = wave2_;
    let _e161 = wave3_;
    let _e163 = wave4_;
    let _e166 = agitation_1;
    h = (_e157 + ((((_e158 + _e159) + _e161) + _e163) * (0.3f + (_e166 * 0.7f))));
    let _e172 = h;
    return _e172;
}

fn liquidNormal(xz_2: vec2<f32>, baseLevel_2: f32, sloshAngle_2: f32, sloshDir_2: f32, agitation_2: f32, visc_2: f32, t_2: f32) -> vec3<f32> {
    var xz_3: vec2<f32>;
    var baseLevel_3: f32;
    var sloshAngle_3: f32;
    var sloshDir_3: f32;
    var agitation_3: f32;
    var visc_3: f32;
    var t_3: f32;
    var eps: f32 = 0.01f;
    var hc: f32;
    var hx: f32;
    var hz: f32;

    xz_3 = xz_2;
    baseLevel_3 = baseLevel_2;
    sloshAngle_3 = sloshAngle_2;
    sloshDir_3 = sloshDir_2;
    agitation_3 = agitation_2;
    visc_3 = visc_2;
    t_3 = t_2;
    let _e50 = xz_3;
    let _e51 = baseLevel_3;
    let _e52 = sloshAngle_3;
    let _e53 = sloshDir_3;
    let _e54 = agitation_3;
    let _e55 = visc_3;
    let _e56 = t_3;
    let _e57 = liquidSurface(_e50, _e51, _e52, _e53, _e54, _e55, _e56);
    hc = _e57;
    let _e59 = xz_3;
    let _e60 = eps;
    let _e64 = baseLevel_3;
    let _e65 = sloshAngle_3;
    let _e66 = sloshDir_3;
    let _e67 = agitation_3;
    let _e68 = visc_3;
    let _e69 = t_3;
    let _e70 = liquidSurface((_e59 + vec2<f32>(_e60, 0f)), _e64, _e65, _e66, _e67, _e68, _e69);
    hx = _e70;
    let _e72 = xz_3;
    let _e74 = eps;
    let _e77 = baseLevel_3;
    let _e78 = sloshAngle_3;
    let _e79 = sloshDir_3;
    let _e80 = agitation_3;
    let _e81 = visc_3;
    let _e82 = t_3;
    let _e83 = liquidSurface((_e72 + vec2<f32>(0f, _e74)), _e77, _e78, _e79, _e80, _e81, _e82);
    hz = _e83;
    let _e85 = hc;
    let _e86 = hx;
    let _e88 = eps;
    let _e89 = hc;
    let _e90 = hz;
    return normalize(vec3<f32>((_e85 - _e86), _e88, (_e89 - _e90)));
}

fn intersectSphere(ro: vec3<f32>, rd: vec3<f32>, r_2: f32) -> vec2<f32> {
    var ro_1: vec3<f32>;
    var rd_1: vec3<f32>;
    var r_3: f32;
    var b: f32;
    var c: f32;
    var disc: f32;
    var sq: f32;

    ro_1 = ro;
    rd_1 = rd;
    r_3 = r_2;
    let _e40 = ro_1;
    let _e41 = rd_1;
    b = dot(_e40, _e41);
    let _e44 = ro_1;
    let _e45 = ro_1;
    let _e47 = r_3;
    let _e48 = r_3;
    c = (dot(_e44, _e45) - (_e47 * _e48));
    let _e52 = b;
    let _e53 = b;
    let _e55 = c;
    disc = ((_e52 * _e53) - _e55);
    let _e58 = disc;
    if (_e58 < 0f) {
        return vec2(-1f);
    }
    let _e64 = disc;
    sq = sqrt(_e64);
    let _e67 = b;
    let _e69 = sq;
    let _e71 = b;
    let _e73 = sq;
    return vec2<f32>((-(_e67) - _e69), (-(_e71) + _e73));
}

fn background(uv: vec2<f32>, t_4: f32) -> vec3<f32> {
    var uv_1: vec2<f32>;
    var t_5: f32;
    var a: f32;
    var r_4: f32;
    var c1_: vec3<f32> = vec3<f32>(0.05f, 0.02f, 0.12f);
    var c2_: vec3<f32> = vec3<f32>(0.12f, 0.06f, 0.18f);
    var col: vec3<f32>;

    uv_1 = uv;
    t_5 = t_4;
    let _e38 = uv_1;
    let _e40 = uv_1;
    a = atan2(_e38.y, _e40.x);
    let _e44 = uv_1;
    r_4 = length(_e44);
    let _e57 = c1_;
    let _e58 = c2_;
    let _e61 = a;
    let _e64 = t_5;
    col = mix(_e57, _e58, vec3((0.5f + (0.5f * sin(((_e61 * 3f) + (_e64 * 0.3f)))))));
    let _e74 = col;
    let _e76 = r_4;
    let _e79 = t_5;
    let _e81 = r_4;
    let _e84 = t_5;
    let _e88 = r_4;
    let _e91 = t_5;
    col = (_e74 + (0.04f * sin(vec3<f32>(((_e76 * 8f) + _e79), ((_e81 * 10f) - (_e84 * 0.5f)), ((_e88 * 12f) + (_e91 * 0.7f))))));
    let _e99 = col;
    return _e99;
}

fn fresnel(viewDir: vec3<f32>, normal: vec3<f32>, f0_: f32) -> f32 {
    var viewDir_1: vec3<f32>;
    var normal_1: vec3<f32>;
    var f0_1: f32;
    var d: f32;

    viewDir_1 = viewDir;
    normal_1 = normal;
    f0_1 = f0_;
    let _e41 = viewDir_1;
    let _e42 = normal_1;
    d = clamp((1f - dot(_e41, _e42)), 0f, 1f);
    let _e49 = f0_1;
    let _e51 = f0_1;
    let _e53 = d;
    let _e55 = d;
    let _e57 = d;
    let _e59 = d;
    let _e61 = d;
    return (_e49 + ((((((1f - _e51) * _e53) * _e55) * _e57) * _e59) * _e61));
}

fn mainImage(fragColor: ptr<function, vec4<f32>>, fragCoord: vec2<f32>) {
    var fragCoord_1: vec2<f32>;
    var uv_2: vec2<f32>;
    var t_6: f32;
    var aspect: f32;
    var agitation_4: f32;
    var beatPulse: f32;
    var sloshAngle_4: f32;
    var sloshDir_4: f32;
    var baseLevel_4: f32;
    var visc_4: f32;
    var refStr: f32;
    var foamAmt: f32;
    var liqColor: vec3<f32>;
    var specShift: f32;
    var ro_2: vec3<f32> = vec3<f32>(0f, 0f, 2.8f);
    var rd_2: vec3<f32>;
    var sphereR: f32 = 0.85f;
    var bgCol: vec3<f32>;
    var tHit: vec2<f32>;
    var entryPos: vec3<f32>;
    var exitPos: vec3<f32>;
    var sphereNormal: vec3<f32>;
    var fres: f32;
    var reflDir: vec3<f32>;
    var envRefl: vec3<f32>;
    var stepSize: f32;
    var marchT: f32;
    var hitLiquid: bool = false;
    var liquidHitPos: vec3<f32> = vec3(0f);
    var liquidDepth: f32 = 0f;
    var i: i32 = 0i;
    var p_2: vec3<f32>;
    var surfH: f32;
    var col_1: vec3<f32>;
    var lNorm: vec3<f32>;
    var refractDir: vec3<f32>;
    var refractUV: vec2<f32>;
    var refractedBg: vec3<f32>;
    var absorption: f32;
    var absorbColor: vec3<f32>;
    var lightDir: vec3<f32> = vec3<f32>(0.36369646f, 0.7273929f, 0.58191437f);
    var spec: f32;
    var lFres: f32;
    var surfDist: f32;
    var foamMask: f32;
    var foamNoise: f32;
    var foamColor: vec3<f32>;
    var caustic: f32;
    var refractDir_1: vec3<f32>;
    var refractUV_1: vec2<f32>;
    var rim: f32;
    var sphereMask: f32;

    fragCoord_1 = fragCoord;
    let _e37 = fragCoord_1;
    let _e39 = u.resolution;
    let _e47 = u.resolution;
    uv_2 = ((_e37 - (0.5f * vec3<f32>(_e39.x, _e39.y, 1f).xy)) / vec2(vec3<f32>(_e47.x, _e47.y, 1f).y));
    let _e56 = u.time_ms;
    t_6 = (_e56 / 1000f);
    let _e60 = u.resolution;
    let _e66 = u.resolution;
    aspect = (vec3<f32>(_e60.x, _e60.y, 1f).x / vec3<f32>(_e66.x, _e66.y, 1f).y);
    let _e74 = u.bass;
    let _e77 = u.peak;
    let _e81 = u.rms;
    agitation_4 = (((_e74 * 0.6f) + (_e77 * 0.3f)) + (_e81 * 0.1f));
    let _e87 = u.beat_phase;
    beatPulse = pow((1f - _e87), 4f);
    let _e92 = agitation_4;
    let _e93 = beatPulse;
    agitation_4 = (_e92 + (_e93 * 0.5f));
    let _e97 = agitation_4;
    agitation_4 = clamp(_e97, 0f, 1f);
    let _e101 = agitation_4;
    let _e104 = t_6;
    sloshAngle_4 = ((_e101 * 0.8f) * sin((_e104 * 2.5f)));
    let _e110 = t_6;
    let _e113 = u.bass;
    sloshDir_4 = ((_e110 * 0.7f) + (_e113 * 6.2831855f));
    let _e118 = p.level;
    baseLevel_4 = _e118.x;
    let _e121 = p.viscosity;
    visc_4 = _e121.x;
    let _e124 = p.refraction;
    refStr = _e124.x;
    let _e127 = p.foam;
    foamAmt = _e127.x;
    let _e130 = p.tint;
    liqColor = _e130.xyz;
    let _e133 = u.mid;
    let _e136 = u.treble;
    specShift = ((_e133 * 0.3f) + (_e136 * 0.2f));
    let _e141 = liqColor;
    let _e142 = liqColor;
    let _e144 = specShift;
    liqColor = mix(_e141, _e142.yzx, vec3((_e144 * 0.4f)));
    let _e154 = uv_2;
    rd_2 = normalize(vec3<f32>(_e154.x, _e154.y, -1.2f));
    let _e164 = uv_2;
    let _e165 = t_6;
    let _e166 = background(_e164, _e165);
    bgCol = _e166;
    let _e168 = ro_2;
    let _e169 = rd_2;
    let _e170 = sphereR;
    let _e171 = intersectSphere(_e168, _e169, _e170);
    tHit = _e171;
    let _e173 = tHit;
    if (_e173.x < 0f) {
        {
            let _e177 = bgCol;
            (*fragColor) = vec4<f32>(_e177.x, _e177.y, _e177.z, 1f);
            return;
        }
    }
    let _e183 = ro_2;
    let _e184 = rd_2;
    let _e185 = tHit;
    entryPos = (_e183 + (_e184 * _e185.x));
    let _e190 = ro_2;
    let _e191 = rd_2;
    let _e192 = tHit;
    exitPos = (_e190 + (_e191 * _e192.y));
    let _e197 = entryPos;
    sphereNormal = normalize(_e197);
    let _e200 = rd_2;
    let _e202 = sphereNormal;
    let _e204 = fresnel(-(_e200), _e202, 0.04f);
    fres = _e204;
    let _e206 = rd_2;
    let _e207 = sphereNormal;
    reflDir = reflect(_e206, _e207);
    let _e217 = reflDir;
    let _e221 = t_6;
    let _e228 = reflDir;
    let _e232 = t_6;
    let _e241 = reflDir;
    let _e245 = t_6;
    envRefl = (vec3<f32>(0.08f, 0.06f, 0.12f) + (0.15f * vec3<f32>((0.5f + (0.5f * sin(((_e217.x * 4f) + _e221)))), (0.5f + (0.5f * sin(((_e228.y * 5f) + (_e232 * 0.7f))))), (0.5f + (0.5f * sin(((_e241.z * 3f) + (_e245 * 1.3f))))))));
    let _e256 = envRefl;
    let _e257 = beatPulse;
    let _e260 = liqColor;
    envRefl = (_e256 + ((_e257 * 0.15f) * _e260));
    let _e263 = tHit;
    let _e265 = tHit;
    stepSize = ((_e263.y - _e265.x) / 48f);
    let _e271 = tHit;
    marchT = _e271.x;
    loop {
        let _e283 = i;
        if !((_e283 < 48i)) {
            break;
        }
        {
            let _e290 = ro_2;
            let _e291 = rd_2;
            let _e292 = marchT;
            p_2 = (_e290 + (_e291 * _e292));
            let _e296 = p_2;
            let _e298 = baseLevel_4;
            let _e299 = sloshAngle_4;
            let _e300 = sloshDir_4;
            let _e301 = agitation_4;
            let _e302 = visc_4;
            let _e303 = t_6;
            let _e304 = liquidSurface(_e296.xz, _e298, _e299, _e300, _e301, _e302, _e303);
            surfH = _e304;
            let _e306 = p_2;
            let _e308 = surfH;
            let _e310 = p_2;
            let _e312 = sphereR;
            if ((_e306.y < _e308) && (length(_e310) < _e312)) {
                {
                    hitLiquid = true;
                    let _e316 = p_2;
                    liquidHitPos = _e316;
                    let _e317 = tHit;
                    let _e319 = marchT;
                    liquidDepth = (_e317.y - _e319);
                    break;
                }
            }
            let _e321 = marchT;
            let _e322 = stepSize;
            marchT = (_e321 + _e322);
        }
        continuing {
            let _e287 = i;
            i = (_e287 + 1i);
        }
    }
    let _e325 = hitLiquid;
    if _e325 {
        {
            let _e326 = liquidHitPos;
            let _e328 = baseLevel_4;
            let _e329 = sloshAngle_4;
            let _e330 = sloshDir_4;
            let _e331 = agitation_4;
            let _e332 = visc_4;
            let _e333 = t_6;
            let _e334 = liquidNormal(_e326.xz, _e328, _e329, _e330, _e331, _e332, _e333);
            lNorm = _e334;
            let _e336 = rd_2;
            let _e337 = lNorm;
            refractDir = refract(_e336, _e337, 0.75f);
            let _e341 = uv_2;
            let _e342 = refractDir;
            let _e344 = refStr;
            refractUV = (_e341 + ((_e342.xz * _e344) * 0.3f));
            let _e350 = refractUV;
            let _e351 = t_6;
            let _e352 = background(_e350, _e351);
            refractedBg = _e352;
            let _e355 = liquidDepth;
            absorption = (1f - exp((-(_e355) * 3f)));
            let _e362 = liqColor;
            let _e365 = absorption;
            absorbColor = (_e362 * (0.6f + (0.4f * _e365)));
            let _e370 = refractedBg;
            let _e373 = absorbColor;
            let _e374 = absorption;
            col_1 = mix((_e370 * 0.4f), _e373, vec3(((_e374 * 0.7f) + 0.3f)));
            let _e391 = lightDir;
            let _e393 = lNorm;
            let _e395 = rd_2;
            spec = pow(max(dot(reflect(-(_e391), _e393), -(_e395)), 0f), 32f);
            let _e403 = col_1;
            let _e404 = spec;
            col_1 = (_e403 + vec3((_e404 * 0.6f)));
            let _e409 = rd_2;
            let _e411 = lNorm;
            let _e413 = fresnel(-(_e409), _e411, 0.02f);
            lFres = _e413;
            let _e415 = col_1;
            let _e416 = envRefl;
            let _e417 = lFres;
            col_1 = mix(_e415, _e416, vec3((_e417 * 0.3f)));
            let _e422 = liquidHitPos;
            let _e424 = liquidHitPos;
            let _e426 = baseLevel_4;
            let _e427 = sloshAngle_4;
            let _e428 = sloshDir_4;
            let _e429 = agitation_4;
            let _e430 = visc_4;
            let _e431 = t_6;
            let _e432 = liquidSurface(_e424.xz, _e426, _e427, _e428, _e429, _e430, _e431);
            surfDist = abs((_e422.y - _e432));
            let _e438 = surfDist;
            let _e440 = foamAmt;
            foamMask = (smoothstep(0.06f, 0f, _e438) * _e440);
            let _e443 = foamMask;
            let _e445 = agitation_4;
            foamMask = (_e443 * (0.3f + (_e445 * 0.7f)));
            let _e452 = liquidHitPos;
            let _e456 = t_6;
            let _e462 = liquidHitPos;
            let _e466 = t_6;
            foamNoise = (0.5f + ((0.5f * sin(((_e452.x * 25f) + (_e456 * 3f)))) * cos(((_e462.z * 20f) - (_e466 * 2f)))));
            let _e474 = foamNoise;
            let _e477 = liquidHitPos;
            let _e482 = t_6;
            foamNoise = (_e474 * (0.5f + (0.5f * sin(((length(_e477.xz) * 15f) + (_e482 * 5f))))));
            let _e490 = foamMask;
            let _e491 = foamNoise;
            foamMask = (_e490 * _e491);
            let _e493 = foamMask;
            let _e495 = u.treble;
            foamMask = (_e493 * (0.5f + (_e495 * 0.5f)));
            let _e502 = liqColor;
            foamColor = mix(vec3(1f), ((_e502 * 1.5f) + vec3(0.3f)), vec3(0.3f));
            let _e512 = col_1;
            let _e513 = foamColor;
            let _e514 = foamMask;
            col_1 = mix(_e512, _e513, vec3(clamp(_e514, 0f, 0.7f)));
            let _e522 = liquidHitPos;
            let _e526 = t_6;
            let _e532 = liquidHitPos;
            let _e536 = t_6;
            caustic = (0.5f + ((0.5f * sin(((_e522.x * 20f) + (_e526 * 2f)))) * sin(((_e532.z * 20f) + (_e536 * 1.5f)))));
            let _e544 = caustic;
            let _e548 = liquidHitPos;
            let _e551 = absorption;
            caustic = (_e544 * ((smoothstep(0f, -0.5f, _e548.y) * _e551) * 0.15f));
            let _e556 = col_1;
            let _e557 = liqColor;
            let _e558 = caustic;
            col_1 = (_e556 + (_e557 * _e558));
        }
    } else {
        {
            let _e561 = rd_2;
            let _e562 = sphereNormal;
            refractDir_1 = refract(_e561, _e562, 0.95f);
            let _e566 = uv_2;
            let _e567 = refractDir_1;
            let _e569 = refStr;
            refractUV_1 = (_e566 + ((_e567.xz * _e569) * 0.15f));
            let _e575 = refractUV_1;
            let _e576 = t_6;
            let _e577 = background(_e575, _e576);
            col_1 = _e577;
            let _e578 = col_1;
            col_1 = (_e578 * vec3<f32>(0.95f, 0.97f, 1f));
        }
    }
    let _e584 = col_1;
    let _e585 = envRefl;
    let _e586 = fres;
    col_1 = mix(_e584, _e585, vec3((_e586 * 0.5f)));
    let _e592 = rd_2;
    let _e594 = sphereNormal;
    rim = pow((1f - abs(dot(-(_e592), _e594))), 3f);
    let _e601 = col_1;
    let _e606 = rim;
    col_1 = (_e601 + (vec3<f32>(0.15f, 0.18f, 0.22f) * _e606));
    let _e609 = col_1;
    let _e610 = liqColor;
    let _e611 = beatPulse;
    col_1 = (_e609 + ((_e610 * _e611) * 0.08f));
    let _e616 = sphereR;
    let _e619 = sphereR;
    let _e622 = entryPos;
    let _e623 = ro_2;
    let _e625 = rd_2;
    let _e626 = tHit;
    sphereMask = smoothstep((_e616 + 0.02f), (_e619 - 0.02f), length(((_e622 - _e623) + (_e625 * _e626.x))));
    let _e633 = col_1;
    (*fragColor) = vec4<f32>(_e633.x, _e633.y, _e633.z, 1f);
    return;
}

fn main_1() {
    var local: vec4<f32>;

    let _e37 = gl_FragCoord_1;
    mainImage((&local), _e37.xy);
    let _e41 = local;
    _fragColor = _e41;
    return;
}

@fragment 
fn fs_main(@builtin(position) gl_FragCoord: vec4<f32>) -> FragmentOutput {
    gl_FragCoord_1 = gl_FragCoord;
    main_1();
    let _e39 = _fragColor;
    return FragmentOutput(_e39);
}


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
    speed: vec4<f32>,
    layers: vec4<f32>,
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

fn hash(n: f32) -> f32 {
    var n_1: f32;

    n_1 = n;
    let _e32 = n_1;
    return fract((sin(_e32) * 43758.547f));
}

fn hash2_(p: vec2<f32>) -> f32 {
    var p_1: vec2<f32>;

    p_1 = p;
    let _e32 = p_1;
    return fract((sin(dot(_e32, vec2<f32>(127.1f, 311.7f))) * 43758.547f));
}

fn vnoise(p_2: vec2<f32>) -> f32 {
    var p_3: vec2<f32>;
    var i: vec2<f32>;
    var f: vec2<f32>;
    var u: vec2<f32>;
    var a: f32;
    var b: f32;
    var c: f32;
    var d: f32;

    p_3 = p_2;
    let _e32 = p_3;
    i = floor(_e32);
    let _e35 = p_3;
    f = fract(_e35);
    let _e38 = f;
    let _e39 = f;
    let _e43 = f;
    u = ((_e38 * _e39) * (vec2(3f) - (2f * _e43)));
    let _e49 = i;
    let _e54 = hash2_((_e49 + vec2<f32>(0f, 0f)));
    a = _e54;
    let _e56 = i;
    let _e61 = hash2_((_e56 + vec2<f32>(1f, 0f)));
    b = _e61;
    let _e63 = i;
    let _e68 = hash2_((_e63 + vec2<f32>(0f, 1f)));
    c = _e68;
    let _e70 = i;
    let _e75 = hash2_((_e70 + vec2<f32>(1f, 1f)));
    d = _e75;
    let _e77 = a;
    let _e78 = b;
    let _e79 = u;
    let _e82 = c;
    let _e83 = d;
    let _e84 = u;
    let _e87 = u;
    return mix(mix(_e77, _e78, _e79.x), mix(_e82, _e83, _e84.x), _e87.y);
}

fn fbm(p_4: vec2<f32>, octaves: i32) -> f32 {
    var p_5: vec2<f32>;
    var octaves_1: i32;
    var value: f32 = 0f;
    var amplitude: f32 = 0.5f;
    var frequency: f32 = 1f;
    var i_1: i32 = 0i;

    p_5 = p_4;
    octaves_1 = octaves;
    loop {
        let _e42 = i_1;
        if !((_e42 < 8i)) {
            break;
        }
        {
            let _e49 = i_1;
            let _e50 = octaves_1;
            if (_e49 >= _e50) {
                break;
            }
            let _e52 = value;
            let _e53 = amplitude;
            let _e54 = p_5;
            let _e55 = frequency;
            let _e57 = vnoise((_e54 * _e55));
            value = (_e52 + (_e53 * _e57));
            let _e60 = frequency;
            frequency = (_e60 * 2f);
            let _e63 = amplitude;
            amplitude = (_e63 * 0.5f);
        }
        continuing {
            let _e46 = i_1;
            i_1 = (_e46 + 1i);
        }
    }
    let _e66 = value;
    return _e66;
}

fn curtain(x: f32, t: f32, amp: f32, freq: f32) -> f32 {
    var x_1: f32;
    var t_1: f32;
    var amp_1: f32;
    var freq_1: f32;
    var wave: f32;

    x_1 = x;
    t_1 = t;
    amp_1 = amp;
    freq_1 = freq;
    let _e38 = x_1;
    let _e41 = t_1;
    wave = (sin(((_e38 * 3f) + (_e41 * 0.4f))) * 0.5f);
    let _e49 = wave;
    let _e50 = x_1;
    let _e53 = t_1;
    let _e60 = amp_1;
    wave = (_e49 + ((sin(((_e50 * 7f) - (_e53 * 0.7f))) * 0.25f) * _e60));
    let _e63 = wave;
    let _e64 = x_1;
    let _e67 = t_1;
    let _e68 = freq_1;
    let _e74 = amp_1;
    wave = (_e63 + ((sin(((_e64 * 13f) + (_e67 * _e68))) * 0.12f) * _e74));
    let _e77 = wave;
    let _e78 = x_1;
    let _e81 = t_1;
    let _e82 = freq_1;
    wave = (_e77 + (sin(((_e78 * 23f) - ((_e81 * _e82) * 1.5f))) * 0.06f));
    let _e91 = wave;
    return _e91;
}

fn curtainGlow(dist: f32, width: f32) -> f32 {
    var dist_1: f32;
    var width_1: f32;
    var d_1: f32;

    dist_1 = dist;
    width_1 = width;
    let _e34 = dist_1;
    let _e36 = width_1;
    d_1 = (abs(_e34) / _e36);
    let _e39 = d_1;
    let _e41 = d_1;
    return exp(((-(_e39) * _e41) * 4f));
}

fn mainImage(fragColor: ptr<function, vec4<f32>>, fragCoord: vec2<f32>) {
    var fragCoord_1: vec2<f32>;
    var uv: vec2<f32>;
    var aspect: f32;
    var t_2: f32;
    var numLayers: i32;
    var bassAmp: f32;
    var trebleFreq: f32;
    var midGlow: f32;
    var energy: f32;
    var beatPulse: f32;
    var bg: vec3<f32>;
    var stars: f32;
    var aurora: vec3<f32> = vec3(0f);
    var baseTint: vec3<f32>;
    var i_2: i32 = 0i;
    var fi: f32;
    var layerOffset: f32;
    var layerSpeed: f32;
    var xCoord: f32;
    var noiseVal: f32;
    var cWave: f32;
    var curtainY: f32;
    var dist_2: f32;
    var width_2: f32;
    var glow: f32;
    var topBias: f32;
    var colorPhase: f32;
    var green: vec3<f32>;
    var cyan: vec3<f32>;
    var purple: vec3<f32>;
    var layerColor: vec3<f32>;
    var shimmer: f32;
    var layerAlpha: f32;
    var rays: f32;
    var verticalFade: f32;
    var col: vec3<f32>;
    var vig: vec2<f32>;
    var vigFactor: f32;

    fragCoord_1 = fragCoord;
    let _e33 = fragCoord_1;
    let _e35 = _cn_u.resolution;
    uv = (_e33.xy / vec3<f32>(_e35.x, _e35.y, 1f).xy);
    let _e43 = _cn_u.resolution;
    let _e49 = _cn_u.resolution;
    aspect = (vec3<f32>(_e43.x, _e43.y, 1f).x / vec3<f32>(_e49.x, _e49.y, 1f).y);
    let _e57 = _cn_u.time_ms;
    let _e60 = _cn_p.speed;
    t_2 = ((_e57 / 1000f) * _e60.x);
    let _e64 = _cn_p.layers;
    numLayers = i32(_e64.x);
    let _e69 = _cn_u.bass;
    bassAmp = (1f + (_e69 * 2.5f));
    let _e75 = _cn_u.treble;
    trebleFreq = (1f + (_e75 * 3f));
    let _e81 = _cn_u.mid;
    midGlow = (1f + (_e81 * 0.5f));
    let _e87 = _cn_u.rms;
    energy = (0.7f + (_e87 * 0.6f));
    let _e93 = _cn_u.beat_phase;
    beatPulse = pow((1f - _e93), 4f);
    let _e106 = uv;
    bg = mix(vec3<f32>(0f, 0f, 0.02f), vec3<f32>(0.01f, 0.01f, 0.06f), vec3(_e106.y));
    let _e111 = uv;
    let _e112 = aspect;
    let _e119 = hash2_(floor((_e111 * vec2<f32>((_e112 * 200f), 200f))));
    stars = pow(_e119, 20f);
    let _e123 = bg;
    let _e124 = stars;
    bg = (_e123 + vec3((_e124 * 0.3f)));
    let _e132 = _cn_p.tint;
    baseTint = _e132.xyz;
    loop {
        let _e137 = i_2;
        if !((_e137 < 8i)) {
            break;
        }
        {
            let _e144 = i_2;
            let _e145 = numLayers;
            if (_e144 >= _e145) {
                break;
            }
            let _e147 = i_2;
            fi = f32(_e147);
            let _e150 = fi;
            layerOffset = (_e150 * 1.618f);
            let _e154 = t_2;
            let _e156 = fi;
            layerSpeed = (_e154 * (0.3f + (_e156 * 0.08f)));
            let _e162 = uv;
            let _e164 = aspect;
            let _e166 = layerOffset;
            xCoord = ((_e162.x * _e164) + _e166);
            let _e169 = xCoord;
            let _e172 = layerSpeed;
            let _e176 = fi;
            let _e179 = t_2;
            let _e185 = fbm(vec2<f32>(((_e169 * 0.8f) + (_e172 * 0.1f)), ((_e176 * 3.7f) + (_e179 * 0.05f))), 5i);
            noiseVal = _e185;
            let _e187 = xCoord;
            let _e188 = layerSpeed;
            let _e189 = bassAmp;
            let _e190 = trebleFreq;
            let _e191 = curtain(_e187, _e188, _e189, _e190);
            cWave = _e191;
            let _e193 = cWave;
            let _e194 = noiseVal;
            let _e199 = bassAmp;
            cWave = (_e193 + (((_e194 - 0.5f) * 0.4f) * _e199));
            let _e203 = fi;
            let _e207 = cWave;
            curtainY = ((0.7f - (_e203 * 0.06f)) + (_e207 * 0.15f));
            let _e212 = uv;
            let _e214 = curtainY;
            dist_2 = (_e212.y - _e214);
            let _e218 = noiseVal;
            let _e222 = _cn_u.bass;
            width_2 = ((0.08f + (_e218 * 0.06f)) + (_e222 * 0.03f));
            let _e227 = dist_2;
            let _e228 = width_2;
            let _e229 = curtainGlow(_e227, _e228);
            glow = _e229;
            let _e234 = dist_2;
            topBias = smoothstep(-0.15f, 0.05f, _e234);
            let _e237 = glow;
            let _e239 = topBias;
            glow = (_e237 * mix(1f, _e239, 0.5f));
            let _e243 = fi;
            let _e244 = numLayers;
            colorPhase = (_e243 / max((f32(_e244) - 1f), 1f));
            green = vec3<f32>(0.1f, 0.9f, 0.3f);
            cyan = vec3<f32>(0.1f, 0.8f, 0.9f);
            purple = vec3<f32>(0.6f, 0.2f, 0.9f);
            let _e268 = colorPhase;
            if (_e268 < 0.5f) {
                {
                    let _e271 = green;
                    let _e272 = cyan;
                    let _e273 = colorPhase;
                    layerColor = mix(_e271, _e272, vec3((_e273 * 2f)));
                }
            } else {
                {
                    let _e278 = cyan;
                    let _e279 = purple;
                    let _e280 = colorPhase;
                    layerColor = mix(_e278, _e279, vec3(((_e280 - 0.5f) * 2f)));
                }
            }
            let _e287 = layerColor;
            let _e288 = baseTint;
            layerColor = mix(_e287, _e288, vec3(0.3f));
            let _e292 = xCoord;
            let _e295 = t_2;
            let _e296 = trebleFreq;
            let _e301 = uv;
            let _e305 = t_2;
            let _e310 = vnoise(vec2<f32>(((_e292 * 15f) + ((_e295 * _e296) * 0.5f)), ((_e301.y * 20f) - (_e305 * 0.3f))));
            shimmer = _e310;
            let _e314 = shimmer;
            shimmer = (0.7f + (0.3f * _e314));
            let _e317 = glow;
            let _e318 = shimmer;
            let _e320 = energy;
            let _e322 = midGlow;
            layerAlpha = (((_e317 * _e318) * _e320) * _e322);
            let _e325 = layerAlpha;
            let _e329 = fi;
            layerAlpha = (_e325 * (0.4f + (0.6f / (1f + (_e329 * 0.3f)))));
            let _e336 = aurora;
            let _e337 = layerColor;
            let _e338 = layerAlpha;
            aurora = (_e336 + (_e337 * _e338));
        }
        continuing {
            let _e141 = i_2;
            i_2 = (_e141 + 1i);
        }
    }
    let _e341 = aurora;
    let _e343 = beatPulse;
    aurora = (_e341 * (1f + (_e343 * 1.2f)));
    let _e348 = uv;
    let _e350 = aspect;
    let _e354 = t_2;
    let _e358 = t_2;
    let _e362 = vnoise(vec2<f32>((((_e348.x * _e350) * 8f) + (_e354 * 0.1f)), (_e358 * 0.05f)));
    rays = _e362;
    let _e364 = rays;
    let _e369 = uv;
    rays = ((pow(_e364, 3f) * 0.15f) * _e369.y);
    let _e372 = aurora;
    let _e377 = rays;
    let _e379 = energy;
    aurora = (_e372 + ((vec3<f32>(0.05f, 0.2f, 0.1f) * _e377) * _e379));
    let _e384 = uv;
    let _e389 = uv;
    verticalFade = (smoothstep(0f, 0.3f, _e384.y) * smoothstep(1f, 0.6f, _e389.y));
    let _e394 = aurora;
    let _e395 = verticalFade;
    aurora = (_e394 * _e395);
    let _e397 = bg;
    let _e398 = aurora;
    col = (_e397 + _e398);
    let _e401 = uv;
    let _e403 = uv;
    vig = (_e401 * (vec2(1f) - _e403));
    let _e408 = vig;
    let _e410 = vig;
    vigFactor = pow(((_e408.x * _e410.y) * 16f), 0.15f);
    let _e418 = col;
    let _e419 = vigFactor;
    col = (_e418 * _e419);
    let _e421 = col;
    let _e423 = col;
    col = (_e421 / (vec3(1f) + _e423));
    let _e427 = col;
    (*fragColor) = vec4<f32>(_e427.x, _e427.y, _e427.z, 1f);
    return;
}

fn main_1() {
    var _fc: vec2<f32>;
    var local: vec4<f32>;

    let _e32 = gl_FragCoord_1;
    let _e34 = _cn_u.resolution;
    let _e36 = gl_FragCoord_1;
    _fc = vec2<f32>(_e32.x, (_e34.y - _e36.y));
    let _e42 = _fc;
    mainImage((&local), _e42);
    let _e45 = local;
    _fragColor = _e45;
    return;
}

@fragment 
fn fs_main(@builtin(position) gl_FragCoord: vec4<f32>) -> FragmentOutput {
    gl_FragCoord_1 = gl_FragCoord;
    main_1();
    let _e35 = _fragColor;
    return FragmentOutput(_e35);
}


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

struct FragmentOutput {
    @location(0) _fragColor: vec4<f32>,
}

@group(0) @binding(0) 
var<uniform> u: Uniforms;
var<private> _fragColor: vec4<f32>;
var<private> gl_FragCoord_1: vec4<f32>;

fn juliaSet(c: vec2<f32>, constant: vec2<f32>) -> i32 {
    var c_1: vec2<f32>;
    var constant_1: vec2<f32>;
    var recursionCount: i32;
    var z: vec2<f32>;

    c_1 = c;
    constant_1 = constant;
    let _e29 = c_1;
    z = _e29;
    recursionCount = 0i;
    loop {
        let _e32 = recursionCount;
        if !((_e32 < 500i)) {
            break;
        }
        {
            let _e39 = z;
            let _e41 = z;
            let _e44 = z;
            let _e46 = z;
            let _e51 = z;
            let _e54 = z;
            let _e58 = constant_1;
            z = (vec2<f32>(((_e39.x * _e41.x) - (_e44.y * _e46.y)), ((2f * _e51.x) * _e54.y)) + _e58);
            let _e60 = z;
            let _e61 = z;
            if (dot(_e60, _e61) > 4f) {
                break;
            }
        }
        continuing {
            let _e36 = recursionCount;
            recursionCount = (_e36 + 1i);
        }
    }
    let _e65 = recursionCount;
    return _e65;
}

fn smoothJulia(c_2: vec2<f32>, constant_2: vec2<f32>) -> f32 {
    var c_3: vec2<f32>;
    var constant_3: vec2<f32>;
    var z_1: vec2<f32>;
    var i: f32;
    var sl: f32;

    c_3 = c_2;
    constant_3 = constant_2;
    let _e28 = c_3;
    z_1 = _e28;
    i = 0f;
    loop {
        let _e32 = i;
        if !((_e32 < 500f)) {
            break;
        }
        {
            let _e40 = z_1;
            let _e42 = z_1;
            let _e45 = z_1;
            let _e47 = z_1;
            let _e52 = z_1;
            let _e55 = z_1;
            let _e59 = constant_3;
            z_1 = (vec2<f32>(((_e40.x * _e42.x) - (_e45.y * _e47.y)), ((2f * _e52.x) * _e55.y)) + _e59);
            let _e61 = z_1;
            let _e62 = z_1;
            if (dot(_e61, _e62) > 256f) {
                break;
            }
        }
        continuing {
            let _e37 = i;
            i = (_e37 + 1f);
        }
    }
    let _e66 = i;
    if (_e66 >= 500f) {
        let _e70 = i;
        return _e70;
    }
    let _e71 = i;
    let _e72 = z_1;
    let _e73 = z_1;
    sl = ((_e71 - log2(log2(dot(_e72, _e73)))) + 4f);
    let _e81 = sl;
    return _e81;
}

fn palette(t: f32) -> vec3<f32> {
    var t_1: f32;
    var a: vec3<f32> = vec3<f32>(0.5f, 0.5f, 0.5f);
    var b: vec3<f32> = vec3<f32>(0.5f, 0.5f, 0.5f);
    var c_4: vec3<f32> = vec3<f32>(1f, 1f, 1f);
    var d: vec3<f32> = vec3<f32>(0f, 0.1f, 0.2f);

    t_1 = t;
    let _e46 = a;
    let _e47 = b;
    let _e49 = c_4;
    let _e50 = t_1;
    let _e52 = d;
    return (_e46 + (_e47 * cos((6.28318f * ((_e49 * _e50) + _e52)))));
}

fn mainImage(fragColor: ptr<function, vec4<f32>>, fragCoord: vec2<f32>) {
    var fragCoord_1: vec2<f32>;
    var uv: vec2<f32>;
    var zoomLevel: f32;
    var a_1: f32;
    var U: vec2<f32>;
    var V: vec2<f32>;
    var t_2: f32;
    var radius: f32;
    var constant_4: vec2<f32>;
    var f: f32;
    var col: vec3<f32>;
    var normalized: f32;
    var hueShift: f32;
    var glow: f32;
    var energy: f32;
    var q: vec2<f32>;

    fragCoord_1 = fragCoord;
    let _e28 = fragCoord_1;
    let _e30 = u.resolution;
    let _e39 = u.resolution;
    uv = ((2f * (_e28 - (0.5f * vec3<f32>(_e30.x, _e30.y, 1f).xy))) / vec2(vec3<f32>(_e39.x, _e39.y, 1f).y));
    let _e49 = u.bass;
    zoomLevel = (1.5f - (_e49 * 0.3f));
    let _e54 = uv;
    let _e55 = zoomLevel;
    uv = (_e54 * _e55);
    let _e60 = u.mid;
    a_1 = (1.0471976f + (_e60 * 0.2f));
    let _e65 = a_1;
    let _e67 = a_1;
    U = vec2<f32>(cos(_e65), sin(_e67));
    let _e71 = U;
    let _e74 = U;
    V = vec2<f32>(-(_e71.y), _e74.x);
    let _e78 = uv;
    let _e79 = U;
    let _e81 = uv;
    let _e82 = V;
    uv = vec2<f32>(dot(_e78, _e79), dot(_e81, _e82));
    let _e85 = u.time_ms;
    let _e90 = u.beat_phase;
    t_2 = (((_e85 / 1000f) * 0.3f) + (_e90 * 0.1f));
    let _e96 = u.treble;
    radius = (0.7885f + (_e96 * 0.05f));
    let _e101 = radius;
    let _e102 = t_2;
    let _e104 = t_2;
    constant_4 = (_e101 * vec2<f32>(cos(_e102), sin(_e104)));
    let _e109 = uv;
    let _e110 = constant_4;
    let _e111 = smoothJulia(_e109, _e110);
    f = _e111;
    let _e114 = f;
    if (_e114 >= 500f) {
        {
            let _e124 = u.rms;
            col = (vec3(0.02f) + (vec3<f32>(0.05f, 0f, 0.1f) * _e124));
        }
    } else {
        {
            let _e127 = f;
            normalized = (_e127 / 50f);
            let _e131 = u.beat_phase;
            let _e134 = u.bass;
            hueShift = ((_e131 * 0.3f) + (_e134 * 0.1f));
            let _e139 = normalized;
            let _e140 = hueShift;
            let _e142 = palette((_e139 + _e140));
            col = _e142;
            let _e144 = f;
            glow = (1f - (_e144 / 500f));
            let _e150 = col;
            let _e152 = glow;
            let _e153 = u.peak;
            col = (_e150 * (1f + ((_e152 * _e153) * 2f)));
        }
    }
    let _e160 = u.rms;
    energy = (0.8f + (_e160 * 0.4f));
    let _e165 = col;
    let _e166 = energy;
    col = (_e165 * _e166);
    let _e168 = fragCoord_1;
    let _e170 = u.resolution;
    q = (_e168.xy / vec3<f32>(_e170.x, _e170.y, 1f).xy);
    let _e178 = col;
    let _e182 = q;
    let _e185 = q;
    let _e189 = q;
    let _e194 = q;
    col = (_e178 * (0.5f + (0.5f * pow(((((16f * _e182.x) * _e185.y) * (1f - _e189.x)) * (1f - _e194.y)), 0.1f))));
    let _e203 = col;
    (*fragColor) = vec4<f32>(_e203.x, _e203.y, _e203.z, 1f);
    return;
}

fn main_1() {
    var local: vec4<f32>;

    let _e27 = gl_FragCoord_1;
    mainImage((&local), _e27.xy);
    let _e31 = local;
    _fragColor = _e31;
    return;
}

@fragment 
fn fs_main(@builtin(position) gl_FragCoord: vec4<f32>) -> FragmentOutput {
    gl_FragCoord_1 = gl_FragCoord;
    main_1();
    let _e29 = _fragColor;
    return FragmentOutput(_e29);
}

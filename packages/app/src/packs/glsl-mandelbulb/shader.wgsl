
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
var<uniform> _cn_u: Uniforms;
var<private> _fragColor: vec4<f32>;
var<private> gl_FragCoord_1: vec4<f32>;

fn Rotate(angle: f32) -> mat2x2<f32> {
    var angle_1: f32;
    var s: f32;
    var c: f32;

    angle_1 = angle;
    let _e26 = angle_1;
    s = sin(_e26);
    let _e29 = angle_1;
    c = cos(_e29);
    let _e32 = c;
    let _e33 = s;
    let _e35 = vec2<f32>(_e32, -(_e33));
    let _e36 = s;
    let _e37 = c;
    let _e38 = vec2<f32>(_e36, _e37);
    return mat2x2<f32>(vec2<f32>(_e35.x, _e35.y), vec2<f32>(_e38.x, _e38.y));
}

fn R(uv: vec2<f32>, p: vec3<f32>, l: vec3<f32>, z: f32) -> vec3<f32> {
    var uv_1: vec2<f32>;
    var p_1: vec3<f32>;
    var l_1: vec3<f32>;
    var z_1: f32;
    var f: vec3<f32>;
    var r: vec3<f32>;
    var u: vec3<f32>;
    var c_1: vec3<f32>;
    var i: vec3<f32>;
    var d: vec3<f32>;

    uv_1 = uv;
    p_1 = p;
    l_1 = l;
    z_1 = z;
    let _e32 = l_1;
    let _e33 = p_1;
    f = normalize((_e32 - _e33));
    let _e44 = f;
    r = normalize(cross(vec3<f32>(0f, 1f, 0f), _e44));
    let _e48 = f;
    let _e49 = r;
    u = cross(_e48, _e49);
    let _e52 = p_1;
    let _e53 = f;
    let _e54 = z_1;
    c_1 = (_e52 + (_e53 * _e54));
    let _e58 = c_1;
    let _e59 = uv_1;
    let _e61 = r;
    let _e64 = uv_1;
    let _e66 = u;
    i = ((_e58 + (_e59.x * _e61)) + (_e64.y * _e66));
    let _e70 = i;
    let _e71 = p_1;
    d = normalize((_e70 - _e71));
    let _e75 = d;
    return _e75;
}

fn hsv2rgb(c_2: vec3<f32>) -> vec3<f32> {
    var c_3: vec3<f32>;
    var K: vec4<f32> = vec4<f32>(1f, 0.6666667f, 0.33333334f, 3f);
    var p_2: vec3<f32>;

    c_3 = c_2;
    let _e36 = c_3;
    let _e38 = K;
    let _e44 = K;
    p_2 = abs(((fract((_e36.xxx + _e38.xyz)) * 6f) - _e44.www));
    let _e49 = c_3;
    let _e51 = K;
    let _e53 = p_2;
    let _e54 = K;
    let _e62 = c_3;
    return (_e49.z * mix(_e51.xxx, clamp((_e53 - _e54.xxx), vec3(0f), vec3(1f)), vec3(_e62.y)));
}

fn mandelbulb(position: vec3<f32>) -> f32 {
    var position_1: vec3<f32>;
    var z_2: vec3<f32>;
    var dr: f32 = 1f;
    var r_1: f32 = 0f;
    var power: f32;
    var i_1: i32 = 0i;
    var theta: f32;
    var phi: f32;
    var zr: f32;
    var dst: f32;

    position_1 = position;
    let _e26 = position_1;
    z_2 = _e26;
    let _e33 = _cn_u.bass;
    power = (8f + (_e33 * 3f));
    loop {
        let _e40 = i_1;
        if !((_e40 < 10i)) {
            break;
        }
        {
            let _e47 = z_2;
            r_1 = length(_e47);
            let _e49 = r_1;
            if (_e49 > 2f) {
                break;
            }
            let _e52 = z_2;
            let _e54 = r_1;
            theta = acos((_e52.z / _e54));
            let _e58 = z_2;
            let _e60 = z_2;
            phi = atan2(_e58.y, _e60.x);
            let _e64 = r_1;
            let _e65 = power;
            let _e69 = power;
            let _e71 = dr;
            dr = (((pow(_e64, (_e65 - 1f)) * _e69) * _e71) + 1f);
            let _e75 = r_1;
            let _e76 = power;
            zr = pow(_e75, _e76);
            let _e79 = theta;
            let _e80 = power;
            theta = (_e79 * _e80);
            let _e82 = phi;
            let _e83 = power;
            phi = (_e82 * _e83);
            let _e85 = zr;
            let _e86 = theta;
            let _e88 = phi;
            let _e91 = phi;
            let _e93 = theta;
            let _e96 = theta;
            z_2 = (_e85 * vec3<f32>((sin(_e86) * cos(_e88)), (sin(_e91) * sin(_e93)), cos(_e96)));
            let _e100 = z_2;
            let _e101 = position_1;
            z_2 = (_e100 + _e101);
        }
        continuing {
            let _e44 = i_1;
            i_1 = (_e44 + 1i);
        }
    }
    let _e104 = r_1;
    let _e107 = r_1;
    let _e109 = dr;
    dst = (((0.5f * log(_e104)) * _e107) / _e109);
    let _e112 = dst;
    return _e112;
}

fn DistanceEstimator(p_3: vec3<f32>) -> f32 {
    var p_4: vec3<f32>;

    p_4 = p_3;
    let _e26 = p_4;
    let _e28 = p_4;
    let _e34 = _cn_u.mid;
    let _e38 = Rotate((-0.9424779f + (_e34 * 0.1f)));
    let _e39 = (_e28.yz * _e38);
    p_4.y = _e39.x;
    p_4.z = _e39.y;
    let _e44 = p_4;
    let _e45 = mandelbulb(_e44);
    return _e45;
}

fn RayMarcher(ro: vec3<f32>, rd: vec3<f32>) -> vec4<f32> {
    var ro_1: vec3<f32>;
    var rd_1: vec3<f32>;
    var steps: f32 = 0f;
    var totalDistance: f32 = 0f;
    var minDistToScene: f32 = 100f;
    var minDistToScenePos: vec3<f32>;
    var col: vec4<f32> = vec4<f32>(0f, 0f, 0f, 1f);
    var curPos: vec3<f32>;
    var hit: bool = false;
    var p_5: vec3<f32>;
    var distance_: f32;
    var hueShift: f32;
    var energy: f32;

    ro_1 = ro;
    rd_1 = rd;
    let _e34 = ro_1;
    minDistToScenePos = _e34;
    let _e42 = ro_1;
    curPos = _e42;
    steps = 0f;
    loop {
        let _e47 = steps;
        if !((_e47 < 150f)) {
            break;
        }
        {
            let _e55 = ro_1;
            let _e56 = totalDistance;
            let _e57 = rd_1;
            p_5 = (_e55 + (_e56 * _e57));
            let _e61 = p_5;
            let _e62 = DistanceEstimator(_e61);
            distance_ = _e62;
            let _e64 = p_5;
            curPos = _e64;
            let _e65 = minDistToScene;
            let _e66 = distance_;
            if (_e65 > _e66) {
                {
                    let _e68 = distance_;
                    minDistToScene = _e68;
                    let _e69 = curPos;
                    minDistToScenePos = _e69;
                }
            }
            let _e70 = totalDistance;
            let _e71 = distance_;
            totalDistance = (_e70 + _e71);
            let _e73 = distance_;
            if (_e73 < 0.0001f) {
                {
                    hit = true;
                    break;
                }
            } else {
                let _e77 = distance_;
                if (_e77 > 200f) {
                    {
                        break;
                    }
                }
            }
        }
        continuing {
            let _e52 = steps;
            steps = (_e52 + 1f);
        }
    }
    let _e80 = _cn_u.beat_phase;
    hueShift = (_e80 * 0.3f);
    let _e84 = hit;
    if _e84 {
        {
            let _e85 = col;
            let _e88 = hueShift;
            let _e90 = curPos;
            let _e97 = vec3<f32>(((0.8f + _e88) + (length(_e90) / 0.5f)), 1f, 0.8f);
            col.x = _e97.x;
            col.y = _e97.y;
            col.z = _e97.z;
            let _e104 = col;
            let _e106 = col;
            let _e108 = hsv2rgb(_e106.xyz);
            col.x = _e108.x;
            col.y = _e108.y;
            col.z = _e108.z;
        }
    } else {
        {
            let _e115 = col;
            let _e118 = hueShift;
            let _e120 = minDistToScenePos;
            let _e127 = vec3<f32>(((0.8f + _e118) + (length(_e120) / 0.5f)), 1f, 0.8f);
            col.x = _e127.x;
            col.y = _e127.y;
            col.z = _e127.z;
            let _e134 = col;
            let _e136 = col;
            let _e138 = hsv2rgb(_e136.xyz);
            col.x = _e138.x;
            col.y = _e138.y;
            col.z = _e138.z;
            let _e145 = col;
            let _e147 = col;
            let _e150 = minDistToScene;
            let _e151 = minDistToScene;
            let _e154 = (_e147.xyz * (1f / (_e150 * _e151)));
            col.x = _e154.x;
            col.y = _e154.y;
            col.z = _e154.z;
            let _e161 = col;
            let _e163 = col;
            let _e169 = _cn_u.time_ms;
            let _e179 = (_e163.xyz / vec3(mix(3000f, 50000f, (0.5f + (0.5f * sin(((_e169 / 1000f) * 3f)))))));
            col.x = _e179.x;
            col.y = _e179.y;
            col.z = _e179.z;
        }
    }
    let _e186 = col;
    let _e188 = col;
    let _e190 = steps;
    let _e194 = (_e188.xyz / vec3((_e190 * 0.08f)));
    col.x = _e194.x;
    col.y = _e194.y;
    col.z = _e194.z;
    let _e201 = col;
    let _e203 = col;
    let _e205 = ro_1;
    let _e206 = minDistToScenePos;
    let _e211 = (_e203.xyz / vec3(pow(distance(_e205, _e206), 2f)));
    col.x = _e211.x;
    col.y = _e211.y;
    col.z = _e211.z;
    let _e219 = _cn_u.peak;
    energy = (3f + (_e219 * 5f));
    let _e224 = col;
    let _e226 = col;
    let _e228 = energy;
    let _e229 = (_e226.xyz * _e228);
    col.x = _e229.x;
    col.y = _e229.y;
    col.z = _e229.z;
    let _e236 = col;
    return _e236;
}

fn mainImage(fragColor: ptr<function, vec4<f32>>, fragCoord: vec2<f32>) {
    var fragCoord_1: vec2<f32>;
    var uv_2: vec2<f32>;
    var ro_2: vec3<f32> = vec3<f32>(0f, 0f, -2f);
    var orbitSpeed: f32;
    var rd_2: vec3<f32>;
    var col_1: vec4<f32>;

    fragCoord_1 = fragCoord;
    let _e27 = fragCoord_1;
    let _e29 = _cn_u.resolution;
    let _e37 = _cn_u.resolution;
    uv_2 = ((_e27 - (0.5f * vec3<f32>(_e29.x, _e29.y, 1f).xy)) / vec2(vec3<f32>(_e37.x, _e37.y, 1f).y));
    let _e46 = uv_2;
    uv_2 = (_e46 * 1.5f);
    let _e57 = _cn_u.time_ms;
    let _e66 = _cn_u.treble;
    orbitSpeed = (((((_e57 / 1000f) * 2f) * 3.1415927f) / 10f) + (_e66 * 0.2f));
    let _e71 = ro_2;
    let _e73 = ro_2;
    let _e75 = orbitSpeed;
    let _e76 = Rotate(_e75);
    let _e77 = (_e73.xz * _e76);
    ro_2.x = _e77.x;
    ro_2.z = _e77.y;
    let _e82 = uv_2;
    let _e83 = ro_2;
    let _e92 = R(_e82, _e83, vec3<f32>(0f, 0f, 1f), 1f);
    rd_2 = _e92;
    let _e94 = ro_2;
    let _e95 = rd_2;
    let _e96 = RayMarcher(_e94, _e95);
    col_1 = _e96;
    let _e98 = col_1;
    let _e99 = _e98.xyz;
    (*fragColor) = vec4<f32>(_e99.x, _e99.y, _e99.z, 1f);
    return;
}

fn main_1() {
    var _fc: vec2<f32>;
    var local: vec4<f32>;

    let _e26 = gl_FragCoord_1;
    let _e28 = _cn_u.resolution;
    let _e30 = gl_FragCoord_1;
    _fc = vec2<f32>(_e26.x, (_e28.y - _e30.y));
    let _e36 = _fc;
    mainImage((&local), _e36);
    let _e39 = local;
    _fragColor = _e39;
    return;
}

@fragment 
fn fs_main(@builtin(position) gl_FragCoord: vec4<f32>) -> FragmentOutput {
    gl_FragCoord_1 = gl_FragCoord;
    main_1();
    let _e29 = _fragColor;
    return FragmentOutput(_e29);
}

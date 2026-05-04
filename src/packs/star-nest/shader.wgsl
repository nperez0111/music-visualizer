
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

fn mainImage(fragColor: ptr<function, vec4<f32>>, fragCoord: vec2<f32>) {
    var fragCoord_1: vec2<f32>;
    var speed: f32;
    var brightness: f32;
    var distfading: f32;
    var uv: vec2<f32>;
    var dir: vec3<f32>;
    var time: f32;
    var a1_: f32;
    var a2_: f32;
    var rot1_: mat2x2<f32>;
    var rot2_: mat2x2<f32>;
    var from_: vec3<f32> = vec3<f32>(1f, 0.5f, 0.5f);
    var s: f32 = 0.1f;
    var fade: f32 = 1f;
    var v: vec3<f32> = vec3(0f);
    var r: i32 = 0i;
    var p: vec3<f32>;
    var pa: f32;
    var a: f32;
    var i: i32;
    var dm: f32;
    var pulse: f32;
    var energy: f32;

    fragCoord_1 = fragCoord;
    let _e28 = u.bass;
    speed = (0.01f + (_e28 * 0.005f));
    let _e34 = u.rms;
    brightness = (0.0015f + (_e34 * 0.002f));
    let _e40 = u.treble;
    distfading = (0.73f - (_e40 * 0.1f));
    let _e45 = fragCoord_1;
    let _e47 = u.resolution;
    uv = ((_e45.xy / vec3<f32>(_e47.x, _e47.y, 1f).xy) - vec2(0.5f));
    let _e59 = uv;
    let _e61 = u.resolution;
    let _e67 = u.resolution;
    uv.y = (_e59.y * (vec3<f32>(_e61.x, _e61.y, 1f).y / vec3<f32>(_e67.x, _e67.y, 1f).x));
    let _e75 = uv;
    let _e77 = (_e75 * 0.8f);
    dir = vec3<f32>(_e77.x, _e77.y, 1f);
    let _e83 = u.time_ms;
    let _e86 = speed;
    time = (((_e83 / 1000f) * _e86) + 0.25f);
    let _e92 = time;
    let _e96 = u.mid;
    a1_ = ((0.5f + (_e92 * 0.3f)) + (_e96 * 0.1f));
    let _e102 = time;
    let _e106 = u.treble;
    a2_ = ((0.8f + (_e102 * 0.2f)) + (_e106 * 0.05f));
    let _e111 = a1_;
    let _e113 = a1_;
    let _e115 = vec2<f32>(cos(_e111), sin(_e113));
    let _e116 = a1_;
    let _e119 = a1_;
    let _e121 = vec2<f32>(-(sin(_e116)), cos(_e119));
    rot1_ = mat2x2<f32>(vec2<f32>(_e115.x, _e115.y), vec2<f32>(_e121.x, _e121.y));
    let _e130 = a2_;
    let _e132 = a2_;
    let _e134 = vec2<f32>(cos(_e130), sin(_e132));
    let _e135 = a2_;
    let _e138 = a2_;
    let _e140 = vec2<f32>(-(sin(_e135)), cos(_e138));
    rot2_ = mat2x2<f32>(vec2<f32>(_e134.x, _e134.y), vec2<f32>(_e140.x, _e140.y));
    let _e149 = dir;
    let _e151 = dir;
    let _e153 = rot1_;
    let _e154 = (_e151.xz * _e153);
    dir.x = _e154.x;
    dir.z = _e154.y;
    let _e159 = dir;
    let _e161 = dir;
    let _e163 = rot2_;
    let _e164 = (_e161.xy * _e163);
    dir.x = _e164.x;
    dir.y = _e164.y;
    let _e174 = from_;
    let _e175 = time;
    let _e178 = time;
    from_ = (_e174 + vec3<f32>((_e175 * 2f), _e178, -2f));
    let _e183 = from_;
    let _e185 = from_;
    let _e187 = rot1_;
    let _e188 = (_e185.xz * _e187);
    from_.x = _e188.x;
    from_.z = _e188.y;
    let _e193 = from_;
    let _e195 = from_;
    let _e197 = rot2_;
    let _e198 = (_e195.xy * _e197);
    from_.x = _e198.x;
    from_.y = _e198.y;
    loop {
        let _e212 = r;
        if !((_e212 < 20i)) {
            break;
        }
        {
            let _e219 = from_;
            let _e220 = s;
            let _e221 = dir;
            p = (_e219 + ((_e220 * _e221) * 0.5f));
            let _e229 = p;
            let _e233 = vec3(1.7f);
            p = abs((vec3(0.85f) - (_e229 - (floor((_e229 / _e233)) * _e233))));
            pa = 0f;
            a = 0f;
            i = 0i;
            loop {
                let _e245 = i;
                if !((_e245 < 17i)) {
                    break;
                }
                {
                    let _e252 = p;
                    let _e254 = p;
                    let _e255 = p;
                    p = ((abs(_e252) / vec3(dot(_e254, _e255))) - vec3(0.53f));
                    let _e262 = a;
                    let _e263 = p;
                    let _e265 = pa;
                    a = (_e262 + abs((length(_e263) - _e265)));
                    let _e269 = p;
                    pa = length(_e269);
                }
                continuing {
                    let _e249 = i;
                    i = (_e249 + 1i);
                }
            }
            let _e273 = a;
            let _e274 = a;
            dm = max(0f, (0.3f - ((_e273 * _e274) * 0.001f)));
            let _e281 = a;
            let _e282 = a;
            let _e283 = a;
            a = (_e281 * (_e282 * _e283));
            let _e286 = r;
            if (_e286 > 6i) {
                let _e289 = fade;
                let _e291 = dm;
                fade = (_e289 * (1f - _e291));
            }
            let _e294 = v;
            let _e295 = fade;
            v = (_e294 + vec3(_e295));
            let _e299 = u.beat_phase;
            let _e300 = u.peak;
            pulse = (1f + ((_e299 * _e300) * 0.5f));
            let _e306 = v;
            let _e307 = s;
            let _e308 = s;
            let _e309 = s;
            let _e311 = s;
            let _e312 = s;
            let _e314 = s;
            let _e316 = s;
            let _e319 = a;
            let _e321 = brightness;
            let _e323 = fade;
            let _e325 = pulse;
            v = (_e306 + ((((vec3<f32>(_e307, (_e308 * _e309), (((_e311 * _e312) * _e314) * _e316)) * _e319) * _e321) * _e323) * _e325));
            let _e328 = fade;
            let _e329 = distfading;
            fade = (_e328 * _e329);
            let _e331 = s;
            s = (_e331 + 0.1f);
        }
        continuing {
            let _e216 = r;
            r = (_e216 + 1i);
        }
    }
    let _e334 = v;
    let _e337 = v;
    v = mix(vec3(length(_e334)), _e337, vec3(0.85f));
    let _e342 = u.rms;
    energy = (1f + (_e342 * 0.5f));
    let _e347 = v;
    let _e350 = energy;
    let _e351 = ((_e347 * 0.01f) * _e350);
    (*fragColor) = vec4<f32>(_e351.x, _e351.y, _e351.z, 1f);
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

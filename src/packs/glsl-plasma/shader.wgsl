
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
    var uv: vec2<f32>;
    var t: f32;
    var speed: f32;
    var scale: f32;
    var warp: f32;
    var pulse: f32;
    var v: f32 = 0f;
    var r: f32;
    var g: f32;
    var b: f32;

    fragCoord_1 = fragCoord;
    let _e27 = fragCoord_1;
    let _e28 = u.resolution;
    uv = (_e27 / vec3<f32>(_e28.x, _e28.y, 1f).xy);
    let _e36 = u.time_ms;
    t = (_e36 / 1000f);
    let _e41 = u.bass;
    speed = (1f + (_e41 * 2f));
    let _e47 = u.mid;
    scale = (10f + (_e47 * 5f));
    let _e53 = u.treble;
    warp = (0.5f + (_e53 * 1.5f));
    let _e60 = u.beat_phase;
    pulse = (0.8f + (0.2f * sin((_e60 * 6.28318f))));
    let _e69 = v;
    let _e70 = uv;
    let _e72 = scale;
    let _e74 = t;
    let _e75 = speed;
    v = (_e69 + sin(((_e70.x * _e72) + (_e74 * _e75))));
    let _e80 = v;
    let _e81 = uv;
    let _e83 = scale;
    let _e85 = t;
    let _e86 = speed;
    v = (_e80 + sin(((_e81.y * _e83) + ((_e85 * _e86) * 0.7f))));
    let _e93 = v;
    let _e94 = uv;
    let _e96 = uv;
    let _e99 = scale;
    let _e103 = t;
    let _e104 = speed;
    v = (_e93 + sin(((((_e94.x + _e96.y) * _e99) * 0.5f) + ((_e103 * _e104) * 1.3f))));
    let _e111 = v;
    let _e112 = uv;
    let _e117 = scale;
    let _e119 = warp;
    let _e121 = t;
    let _e122 = speed;
    v = (_e111 + sin((((length((_e112 - vec2(0.5f))) * _e117) * _e119) - ((_e121 * _e122) * 0.9f))));
    let _e129 = v;
    v = ((_e129 / 4f) + 0.5f);
    let _e137 = v;
    let _e140 = t;
    r = (0.5f + (0.5f * cos((6.28318f * ((_e137 + 0f) + (_e140 * 0.1f))))));
    let _e152 = v;
    let _e155 = t;
    g = (0.5f + (0.5f * cos((6.28318f * ((_e152 + 0.33f) + (_e155 * 0.1f))))));
    let _e167 = v;
    let _e170 = t;
    b = (0.5f + (0.5f * cos((6.28318f * ((_e167 + 0.67f) + (_e170 * 0.1f))))));
    let _e179 = r;
    let _e180 = pulse;
    let _e182 = g;
    let _e183 = pulse;
    let _e185 = b;
    let _e186 = pulse;
    (*fragColor) = vec4<f32>((_e179 * _e180), (_e182 * _e183), (_e185 * _e186), 1f);
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

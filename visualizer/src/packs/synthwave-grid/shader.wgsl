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
  grid    : vec4<f32>,
  sun     : vec4<f32>,
  horizon : vec4<f32>,
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  // y_ndc: 0 at top, 1 at bottom (canvas-style).
  let y_ndc = 1.0 - pix.y;
  let x_ndc = (pix.x - 0.5) * aspect;

  let t = u.time_ms * 0.001 * p.speed.x;
  let horizon = clamp(p.horizon.x, 0.15, 0.85);

  // ---- Sky gradient (deep purple -> magenta horizon) ----
  let sky_t = clamp((1.0 - y_ndc) / (1.0 - horizon), 0.0, 1.0);
  var sky = mix(
    vec3<f32>(0.06, 0.02, 0.18),
    vec3<f32>(0.35, 0.05, 0.45),
    sky_t
  );

  // Star specks (only above horizon).
  if (y_ndc > horizon) {
    let s = fract(sin(dot(floor(vec2<f32>(x_ndc * 200.0, y_ndc * 200.0)), vec2<f32>(127.1, 311.7))) * 43758.5453);
    let twinkle = step(0.997, s) * (0.5 + 0.5 * sin(t * 4.0 + s * 30.0));
    sky = sky + vec3<f32>(twinkle);
  }

  // ---- Sun ----
  let sun_center = vec2<f32>(0.0, horizon + 0.18);
  let sun_uv = vec2<f32>(x_ndc, y_ndc) - sun_center;
  let sun_r = length(sun_uv);
  let sun_radius = 0.16 + 0.04 * u.bass;
  let sun_disk = smoothstep(sun_radius, sun_radius - 0.01, sun_r);
  let sun_glow = pow(smoothstep(0.6, 0.0, sun_r), 1.6) * (0.7 + 0.6 * u.bass);

  // Horizontal cut bars across sun (classic outrun).
  let bar_y = sun_uv.y * 8.0;
  let bar_cut_top = step(0.05, sun_uv.y) * step(fract(bar_y - t * 0.6), 0.55);
  let sun_alpha = sun_disk * (1.0 - bar_cut_top * step(sun_uv.y, sun_radius * 0.95));

  // Sun gradient: warm bottom, cool top.
  let sun_grad = mix(p.sun.xyz, p.sun.xyz * vec3<f32>(1.2, 0.4, 0.8), clamp(sun_uv.y / sun_radius * 0.5 + 0.5, 0.0, 1.0));
  sky = sky + sun_grad * sun_glow;
  sky = mix(sky, sun_grad, sun_alpha);

  // ---- Ground perspective grid ----
  if (y_ndc < horizon) {
    let dist_below = max(horizon - y_ndc, 0.001);
    // Convert to ground plane: z grows fast as we approach horizon from below.
    let z = 0.5 / dist_below;
    let perspective_x = x_ndc * z;

    // Scroll the grid along z (toward viewer).
    let scroll = t * (1.5 + 2.0 * u.mid);
    let z_scroll = z + scroll;

    // Distance to nearest grid line (in cell units).
    let gx = abs(fract(perspective_x) - 0.5);
    let gz = abs(fract(z_scroll) - 0.5);

    // Line width in screen space — fade with distance so far lines don't alias.
    let line_w = 0.025 + 0.02 * dist_below;
    let line_x = smoothstep(line_w, 0.0, 0.5 - gx);
    let line_z = smoothstep(line_w, 0.0, 0.5 - gz);
    let line = max(line_x, line_z);

    // Fade lines as they recede.
    let fade = smoothstep(0.0, 0.4, dist_below);
    let glow = line * fade * (0.7 + 0.5 * u.treble);
    let ground_base = mix(vec3<f32>(0.02, 0.01, 0.06), p.grid.xyz * 0.2, fade);
    let ground = ground_base + p.grid.xyz * glow;
    sky = ground;
  }

  // Beat punch on the whole scene (subtle).
  let pulse = pow(1.0 - u.beat_phase, 8.0) * (0.2 + u.peak * 0.4);
  let color = sky + vec3<f32>(pulse * 0.08);

  return vec4<f32>(color, 1.0);
}

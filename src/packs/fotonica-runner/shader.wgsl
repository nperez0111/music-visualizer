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
  speed       : vec4<f32>, // x = base flight speed
  beatPunch   : vec4<f32>, // x = beat advance kick magnitude
  density     : vec4<f32>, // x = gate count (4..24)
  bob         : vec4<f32>, // x = running bob amount
  lineColor   : vec4<f32>, // xyz = wireframe color
  accentColor : vec4<f32>, // xyz = beat-flash accent color
  bgColor     : vec4<f32>, // xyz = void background color
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn pmod(x: f32, m: f32) -> f32 {
  return x - m * floor(x / m);
}

fn hash1(n: f32) -> f32 {
  return fract(sin(n * 91.7 + 47.3) * 12345.6789);
}

// Signed distance to an axis-aligned rectangle outline (half-extents h).
fn sdRect(q: vec2<f32>, h: vec2<f32>) -> f32 {
  let d = abs(q) - h;
  return length(max(d, vec2<f32>(0.0, 0.0))) + min(max(d.x, d.y), 0.0);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  let uv = (pix * 2.0 - vec2<f32>(1.0, 1.0)) * vec2<f32>(aspect, -1.0);
  let t = u.time_ms * 0.001;

  // ---- Forward motion: always-on baseline + audio reactivity + beat kick ----
  let base_v = (0.6 + p.speed.x) * (1.0 + u.bass * 1.1 + u.rms * 0.25);
  let kick   = p.beatPunch.x * 0.18 * pow(1.0 - u.beat_phase, 4.0);
  let cam_z  = t * base_v + kick;

  // ---- Vertical bob: foot strike on every beat, leap mid-beat, plus a
  // sharp upward kick right at onset so each beat lifts the camera. ----
  let TWO_PI = 6.28318530718;
  let stride   = -cos(u.beat_phase * TWO_PI);                    // -1 at onset, +1 mid-beat
  let bob_amp  = 0.16 * p.bob.x;
  let jump_amp = 0.07 * p.bob.x * pow(1.0 - u.beat_phase, 3.0);  // extra leap at onset
  let cam_y    = stride * bob_amp + jump_amp;

  // Pinhole view ray.
  let focal = 1.4;
  let dir = normalize(vec3<f32>(uv.x, uv.y, focal));

  // ---- Floor & ceiling grids ----
  let floor_h = 0.45;
  let ceil_h  = 0.65;
  let grid_density = 1.6;  // grid lines per world unit (denser = stronger speed sense)
  var floor_lines: f32 = 0.0;
  var ceil_lines:  f32 = 0.0;

  // Floor: ray hits y = -floor_h. Camera at y=cam_y → t = (-floor_h - cam_y) / dir.y
  let dy_down = min(dir.y, -0.0001);
  let t_floor = (-floor_h - cam_y) / dy_down;
  let wf_x = dir.x * t_floor * grid_density;
  let wf_z = (dir.z * t_floor + cam_z) * grid_density;
  let lw_fx = fwidth(wf_x) * 1.2 + 0.005;
  let lw_fz = fwidth(wf_z) * 1.2 + 0.005;
  let dfx = abs(fract(wf_x + 0.5) - 0.5);
  let dfz = abs(fract(wf_z + 0.5) - 0.5);
  let lfx = smoothstep(lw_fx, 0.0, dfx);
  let lfz = smoothstep(lw_fz, 0.0, dfz);
  let floor_grid_raw = max(lfx, lfz);
  let floor_fade = exp(-t_floor * 0.04) * smoothstep(0.0, 0.04, -dir.y);
  floor_lines = floor_grid_raw * floor_fade;

  // Ceiling: ray hits y = +ceil_h. t = (ceil_h - cam_y) / dir.y
  let dy_up = max(dir.y, 0.0001);
  let t_ceil = (ceil_h - cam_y) / dy_up;
  let wc_x = dir.x * t_ceil * grid_density;
  let wc_z = (dir.z * t_ceil + cam_z) * grid_density;
  let lw_cx = fwidth(wc_x) * 1.2 + 0.005;
  let lw_cz = fwidth(wc_z) * 1.2 + 0.005;
  let dcx = abs(fract(wc_x + 0.5) - 0.5);
  let dcz = abs(fract(wc_z + 0.5) - 0.5);
  let lcx = smoothstep(lw_cx, 0.0, dcx);
  let lcz = smoothstep(lw_cz, 0.0, dcz);
  let ceil_grid_raw = max(lcx, lcz);
  let ceil_fade = exp(-t_ceil * 0.05) * smoothstep(0.0, 0.04, dir.y);
  ceil_lines = ceil_grid_raw * ceil_fade * 0.55;

  // ---- Obstacle gates ----
  let N = i32(clamp(p.density.x, 4.0, 24.0));
  let spacing = 2.6;
  let far_z = f32(N) * spacing;
  var gates_total: f32 = 0.0;

  for (var i: i32 = 0; i < 24; i = i + 1) {
    if (i >= N) { break; }
    // Distance from camera, wrapped so gates recycle as we advance.
    let raw = f32(i) * spacing - cam_z;
    let dist = pmod(raw, far_z) + 0.05;

    // Project gate to screen — gate centered at world (0, 0, dist), camera bobs
    // at y=cam_y, so the gate's screen-Y shifts opposite to the camera bob.
    let h = hash1(f32(i) * 17.13 + 3.7);
    let sw_world = 0.95;
    let sh_world = 0.50;
    let s_w = sw_world * focal / dist;
    let s_h = sh_world * focal / dist;
    let gate_screen_y = -cam_y * focal / dist;
    let q = uv - vec2<f32>(0.0, gate_screen_y);

    // Outer outline.
    let outer_sdf = sdRect(q, vec2<f32>(s_w, s_h));

    // Inner aperture varies per gate: tall door / wide rect / low slit / square.
    let kind = i32(floor(h * 4.0));
    var iw: f32 = sw_world * 0.55;
    var ih: f32 = sh_world * 0.55;
    if (kind == 0) { iw = sw_world * 0.30; ih = sh_world * 0.85; }
    else if (kind == 1) { iw = sw_world * 0.85; ih = sh_world * 0.45; }
    else if (kind == 2) { iw = sw_world * 0.85; ih = sh_world * 0.18; }
    else { iw = sw_world * 0.50; ih = sh_world * 0.55; }
    let i_w = iw * focal / dist;
    let i_h = ih * focal / dist;
    let inner_sdf = sdRect(q, vec2<f32>(i_w, i_h));

    // Outline = thin band around |sdf| ≈ 0. Width tapers with distance.
    let line_w = clamp(0.003 + 0.012 / dist, 0.003, 0.04);
    let outer_line = smoothstep(line_w, 0.0, abs(outer_sdf));
    let inner_line = smoothstep(line_w * 0.85, 0.0, abs(inner_sdf));

    // Depth fade — gates in the far half of the corridor fade out before pop-in.
    let fade = 1.0 - smoothstep(far_z * 0.55, far_z * 0.95, dist);

    gates_total = gates_total + (outer_line + inner_line * 0.7) * fade;
  }

  // ---- Always-on radial speed streaks scaled by velocity ----
  // Vanishing point sits at the horizon, which moves opposite to the bob.
  let horizon_y = -cam_y * focal / 8.0;            // far-distance projection of cam_y
  let q_streak = uv - vec2<f32>(0.0, horizon_y);
  let r = length(q_streak);
  let theta = atan2(q_streak.y, q_streak.x);
  // Phase tied to cam_z so streaks visibly stream by even at low audio energy.
  let streak_band = pow(0.5 + 0.5 * sin(theta * 38.0 + cam_z * 8.0), 50.0);
  let streak_fall = smoothstep(0.20, 1.4, r);
  let always_on   = 0.18 + p.speed.x * 0.06;       // baseline so motion never stops
  let streak_amp  = always_on + u.peak * 0.45 + u.bass * 0.4;
  let streaks = streak_band * streak_fall * streak_amp;

  // ---- Composition ----
  let beat_flash = pow(1.0 - u.beat_phase, 8.0);
  let line_tint = mix(p.lineColor.xyz, p.accentColor.xyz, beat_flash * 0.7);

  var col = p.bgColor.xyz;
  col = col + line_tint * (
      floor_lines * 0.85
    + ceil_lines  * 1.0
    + gates_total * 1.20
    + streaks     * 0.80
  );

  // Vignette toward edges.
  let vignette = 1.0 - 0.45 * dot(uv, uv);
  col = col * vignette;

  // Vanishing-point dot — clear forward target that moves with the bob.
  let vp_d = length(uv - vec2<f32>(0.0, horizon_y));
  let vp = exp(-vp_d * 80.0) * 0.9 + exp(-vp_d * 14.0) * 0.15;
  col = col + p.lineColor.xyz * vp;

  // Faint horizon haze where floor meets ceiling.
  let horizon = exp(-abs(uv.y - horizon_y) * 18.0) * 0.06;
  col = col + p.lineColor.xyz * horizon;

  // Central glow on beat onset.
  let center_glow = beat_flash * exp(-vp_d * 4.0) * 0.30;
  col = col + p.accentColor.xyz * center_glow;

  return vec4<f32>(col, 1.0);
}

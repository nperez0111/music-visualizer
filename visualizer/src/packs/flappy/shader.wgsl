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

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn hash11(n: f32) -> f32 {
  return fract(sin(n * 12.9898) * 43758.5453);
}

fn rotate2d(p: vec2<f32>, a: f32) -> vec2<f32> {
  let c = cos(a);
  let s = sin(a);
  return vec2<f32>(c * p.x - s * p.y, s * p.x + c * p.y);
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let aspect = u.resolution.x / u.resolution.y;
  // World coords: y up in [-1,1], x in [0, 2*aspect] so pipe sizes stay square.
  let world_x = pix.x * 2.0 * aspect;
  let world_y = (1.0 - pix.y) * 2.0 - 1.0;
  let t = u.time_ms * 0.001;

  // ── Sky gradient ──────────────────────────────────────────────
  let sky_top    = vec3<f32>(0.32, 0.66, 0.92);
  let sky_bottom = vec3<f32>(0.95, 0.88, 0.62);
  var color = mix(sky_bottom, sky_top, smoothstep(-1.0, 1.0, world_y));
  color = color + vec3<f32>(u.rms * 0.05, u.rms * 0.03, -u.rms * 0.04);

  // ── Distant cloud streaks ─────────────────────────────────────
  let cloud_x = world_x - t * 0.06;
  let cloud_band = smoothstep(0.30, 0.55, world_y) - smoothstep(0.55, 0.85, world_y);
  let cloud_n = sin(cloud_x * 1.6) * 0.5 + sin(cloud_x * 0.7 + 1.3) * 0.5;
  let cloud_mask = smoothstep(0.10, 0.55, cloud_n) * cloud_band;
  color = mix(color, vec3<f32>(1.0, 1.0, 1.0), cloud_mask * 0.55);

  // ── Pipes (scroll right→left; deterministic per pipe index) ───
  let scroll_speed = 0.18;
  let scroll = t * scroll_speed;
  let pipe_spacing = 0.95;
  let pipe_width   = 0.30;
  let gap_size     = 0.65;
  let pipe_color   = vec3<f32>(0.36, 0.78, 0.20);
  let pipe_dark    = vec3<f32>(0.22, 0.52, 0.13);

  let s = world_x + scroll;
  let pipe_idx = floor(s / pipe_spacing);
  let local_x  = (s - pipe_idx * pipe_spacing) - pipe_spacing * 0.5;
  // Per-pipe gap center, fixed for the lifetime of each pipe.
  let gap_center = (hash11(pipe_idx + 1.7) - 0.5) * 0.7;
  let half_w   = pipe_width * 0.5;
  let half_gap = gap_size * 0.5;

  let in_shaft_col = abs(local_x) < half_w;
  let in_top_shaft = in_shaft_col && world_y > gap_center + half_gap;
  let in_bot_shaft = in_shaft_col && world_y < gap_center - half_gap;

  let cap_w = pipe_width + 0.07;
  let cap_h = 0.08;
  let in_cap_col = abs(local_x) < cap_w * 0.5;
  let in_top_cap = in_cap_col && world_y > gap_center + half_gap
                              && world_y < gap_center + half_gap + cap_h;
  let in_bot_cap = in_cap_col && world_y < gap_center - half_gap
                              && world_y > gap_center - half_gap - cap_h;

  if (in_top_shaft || in_bot_shaft || in_top_cap || in_bot_cap) {
    let shade_t = (local_x + cap_w * 0.5) / cap_w;
    var pcol = mix(pipe_dark, pipe_color, smoothstep(0.0, 0.45, shade_t));
    pcol = mix(pcol, pipe_dark, smoothstep(0.65, 1.0, shade_t));
    if (in_top_cap || in_bot_cap) {
      pcol = mix(pcol, vec3<f32>(1.0, 1.0, 0.85), 0.18);
    }
    // Dark outline at column edges to separate pipe from sky.
    let edge = min(abs(abs(local_x) - half_w), abs(abs(local_x) - cap_w * 0.5));
    if (edge < 0.005) { pcol = pcol * 0.55; }
    color = pcol;
  }

  // ── Ground (dirt + grass strip) ───────────────────────────────
  let ground_y = -0.78;
  if (world_y < ground_y) {
    let dirt = vec3<f32>(0.62, 0.43, 0.22);
    let grass = vec3<f32>(0.42, 0.74, 0.20);
    let grass_band = smoothstep(ground_y - 0.06, ground_y, world_y);
    var gcol = mix(dirt, grass, grass_band);
    let speckle = step(0.94, hash11(floor(world_x * 40.0) + floor(world_y * 60.0) * 7.0));
    gcol = gcol - vec3<f32>(speckle * 0.07);
    color = gcol;
  }

  // ── Bird ──────────────────────────────────────────────────────
  let bird_x = 0.6 * aspect;
  // Bird tracks the gap of the pipe currently at its x, then eases toward
  // the next pipe's gap during the second half of each cell. cell_t is 0
  // when the bird just entered a cell, 0.5 when it's at the pipe's center.
  let s_bird = bird_x + scroll;
  let pipe_idx_bird = floor(s_bird / pipe_spacing);
  let cell_t = (s_bird - pipe_idx_bird * pipe_spacing) / pipe_spacing;
  let cur_gap  = (hash11(pipe_idx_bird + 1.7) - 0.5) * 0.7;
  let next_gap = (hash11(pipe_idx_bird + 2.7) - 0.5) * 0.7;
  let blend    = smoothstep(0.5, 1.0, cell_t);
  let target_y = mix(cur_gap, next_gap, blend);
  // Beat-bounce on top, kept small so the bird still fits through gaps.
  let kick = 0.07 * pow(1.0 - u.beat_phase, 2.0);
  let bob  = (u.bass - 0.30) * 0.06;
  let bird_y = target_y + kick + bob;
  // Tilt: nose up while climbing toward the next gap, down while falling.
  let dy = next_gap - cur_gap;
  let tilt = clamp(dy * 1.6, -0.7, 0.7) * smoothstep(0.45, 1.0, cell_t)
           + (0.45 - u.beat_phase) * 0.25;

  let to_bird = vec2<f32>(world_x - bird_x, world_y - bird_y);
  let local = rotate2d(to_bird, -tilt);
  let body_d = length(local) - 0.13;

  // Wing: ellipse on the side, flaps faster with treble.
  let flap = sin(t * 14.0 + u.beat_phase * 6.28) * (0.30 + u.treble * 0.6);
  let wing_p_r = rotate2d(local - vec2<f32>(-0.02, -0.02), flap);
  let wing_d = length(vec2<f32>(wing_p_r.x * 1.2, wing_p_r.y * 2.4)) - 0.085;

  let eye_d  = length(local - vec2<f32>(0.06, 0.045)) - 0.020;
  let beak_p = local - vec2<f32>(0.13, 0.005);
  let beak_d = max(abs(beak_p.x) - 0.045, abs(beak_p.y) - 0.024);

  if (body_d < 0.0) {
    let shade = 1.0 - smoothstep(-0.13, 0.0, body_d) * 0.4;
    var bcol = vec3<f32>(0.99, 0.86, 0.18) * shade;
    let cheek_d = length(local - vec2<f32>(0.05, -0.03)) - 0.030;
    if (cheek_d < 0.0) {
      bcol = mix(bcol, vec3<f32>(1.0, 0.55, 0.55), 0.55);
    }
    color = bcol;
  }
  if (wing_d < 0.0) {
    color = mix(color, vec3<f32>(0.92, 0.66, 0.10), 0.85);
  }
  if (beak_d < 0.0) {
    color = vec3<f32>(0.98, 0.55, 0.10);
  }
  if (eye_d < 0.005 && eye_d >= 0.0) {
    color = vec3<f32>(1.0, 1.0, 1.0);
  }
  if (eye_d < 0.0) {
    color = vec3<f32>(0.05, 0.05, 0.07);
  }
  // Soft outline around body so it pops over pipes.
  if (body_d > 0.0 && body_d < 0.012) {
    color = mix(color, vec3<f32>(0.10, 0.08, 0.05), 0.7);
  }

  return vec4<f32>(color, 1.0);
}

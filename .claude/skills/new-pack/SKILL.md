---
name: new-pack
description: Scaffold a new visualizer pack for the music-visualizer project. Use when the user wants to create a new visualizer, write a custom shader, add a Tier 2 (WASM) pack, or asks how to add their own visuals to the music-visualizer app. Asks the user for the pack name + tier, then writes manifest.json, shader.wgsl, and (for Tier 2) pack.ts so it builds via `bun run build:packs`.
---

# Create a new visualizer pack

This skill scaffolds a new pack inside `src/packs/<id>/`. Packs are the
unit of visualizer extensibility in this project. See `ARCHITECTURE.md`
(sibling of this skill in the repo) for the full contract.

## Step 1 — clarify with the user

Use `AskUserQuestion` to decide:

1. **Pack id and display name** — id is used for the directory name and
   manifest `id` (lowercase, `[a-z0-9_-]`); name is human-readable.
2. **Tier** — single-select:
   - **Tier 1 (shader-only)** — recommended default. `manifest.json` +
     `shader.wgsl`. Visualizers that depend only on host-provided audio
     features (rms, peak, bass/mid/treble, BPM, beat phase, FFT
     spectrum) and time fit this tier perfectly.
   - **Tier 2 (with WASM)** — adds a `pack.wasm` that computes per-frame
     custom uniforms in arbitrary code. Pick this when the visualizer
     needs state across frames (e.g. cumulative energy, scene timers,
     particle systems with non-deterministic motion).
3. **Visual seed** — short free-text describing the look (e.g. "tunnel
   that pulses with bass", "spectrum bars only", "kaleidoscope"). Used
   to inform the shader template you write.
4. **Parameters** — propose 2–4 controls that fit the visual seed
   (speed, tint, density, intensity, mode toggle, etc.) and confirm with
   the user. Don't ship a pack with no knobs unless the user explicitly
   asks for a fixed-look pack.

If any of those are obvious from the conversation, skip asking.

## Step 2 — confirm the working directory

The packs directory lives at `<repo>/src/packs/`. Verify it exists with
`ls`.

## Step 3 — scaffold files

### Always: `manifest.json`

```json
{
  "schemaVersion": 1,
  "id": "<id>",
  "name": "<Name>",
  "version": "0.1.0",
  "author": "<author>",
  "description": "<one-sentence description>",
  "shader": "shader.wgsl"
}
```

For Tier 2, add `"wasm": "pack.wasm"`.

**Strongly recommended**: declare user-tweakable controls under
`"parameters"`. Packs without parameters feel inert in the controls
panel; almost every visual idea has at least one knob worth exposing
(speed, tint, density, palette pick, intensity). Aim for 2–4 parameters
on a new pack — enough that the user can dial in a look they like. See
"Pack parameters" below for the full schema and binding layout.

Example `parameters` block:

```json
"parameters": [
  { "type": "float", "name": "speed", "label": "speed", "min": 0.0, "max": 4.0, "default": 1.0 },
  { "type": "color", "name": "tint",  "label": "tint",  "default": [1.0, 0.9, 0.8] },
  { "type": "enum",  "name": "mode",  "label": "mode",  "options": ["calm","wild"], "default": "calm" }
]
```

Supported types: `float`, `int`, `bool`, `enum`, `color`, `range`,
`vec2`, `vec3`, `vec4`. Names must match `[a-z][a-z0-9_]{0,31}`.

### Always: `shader.wgsl`

Use this template. The `Uniforms` struct **must** match what the host
provides. The vertex shader is a fullscreen-triangle (no vertex buffer);
keep it as-is.

```wgsl
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
  spectrum    : array<vec4<f32>, 8>, // 32 log-spaced FFT bins
  // Tier 2 only — append after spectrum (offset 176):
  // packData : vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

// Pack-declared parameters. Each manifest parameter occupies one vec4 slot in
// declaration order; scalars use `.x`, colors/vec3 use `.xyz`, etc.
struct Params {
  speed  : vec4<f32>, // x = speed multiplier
  tint   : vec4<f32>, // xyz = tint color
  mode   : vec4<f32>, // x = enum index (0 = "calm", 1 = "wild")
};
@group(1) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  let x = f32((vid << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(vid & 2u) * 2.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

fn spectrumAt(idx: u32) -> f32 {
  let v = u.spectrum[idx >> 2u];
  let lane = idx & 3u;
  if (lane == 0u) { return v.x; }
  if (lane == 1u) { return v.y; }
  if (lane == 2u) { return v.z; }
  return v.w;
}

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let pix = frag_pos.xy / u.resolution;
  let uv  = pix * 2.0 - vec2<f32>(1.0, 1.0);
  let t = u.time_ms * 0.001 * p.speed.x;

  // <-- replace this with the actual visual idea -->
  var color = vec3<f32>(
    0.5 + 0.5 * sin(t + uv.x * 6.0 + u.bass * 6.0),
    0.5 + 0.5 * sin(t * 1.3 + uv.y * 6.0 + u.mid * 6.0),
    0.5 + 0.5 * sin(t * 1.7 + length(uv) * 6.0 + u.treble * 6.0)
  );
  // Apply user tint.
  color = mix(color, color * p.tint.xyz, 0.5);

  // Beat flash (cheap; remove if unwanted)
  let pulse = pow(1.0 - u.beat_phase, 6.0) * 0.4;
  color = color + vec3<f32>(pulse);

  return vec4<f32>(color, 1.0);
}
```

Tailor the fragment body to the user's visual seed. Audio reactivity
hooks: `u.rms` overall loudness, `u.bass`/`u.mid`/`u.treble` bands, the
`spectrumAt(i)` helper for individual bins, `u.beat_phase` (0 at the
beat, climbs to 1 by the next), `u.peak` for transient response. Wire
each manifest parameter into the fragment so users actually feel their
adjustments — at minimum a speed multiplier and a tint, plus whatever
extra knobs match the visual idea.

Optional: include the standard spectrum strip at the bottom (see
`src/packs/gradient/shader.wgsl` for the canonical block) by copy-paste.
Skip it if the user wants a clean fullscreen visual.

### Pack parameters (`@group(1)`)

If `manifest.json` declares `parameters`, the host allocates a per-pack
parameter buffer and binds it at `@group(1) @binding(0)`. **Each
parameter consumes exactly one `vec4` slot in manifest order**, so the
WGSL `Params` struct must list one `vec4<f32>` field per manifest entry,
in the same order:

| Manifest type            | WGSL slot meaning                                |
|--------------------------|--------------------------------------------------|
| `float`, `int`, `bool`   | scalar in `.x`                                   |
| `enum`                   | option index in `.x` (0..options.length-1)       |
| `range`                  | `[lo, hi]` in `.xy`                              |
| `color`, `vec3`          | RGB / xyz in `.xyz`                              |
| `vec2`                   | `.xy`                                            |
| `vec4`                   | full `.xyzw`                                     |

If you declare parameters in the manifest but never bind `@group(1)` in
WGSL, pipeline creation throws — and vice versa. Keep them in lockstep.

### Prev-frame feedback (`@group(2)`)

Packs that want a feedback/decay buffer can opt in by binding
`@group(2)` in WGSL. The host autodetects this (regex on `@group(2)`)
and wires up the previous frame's render texture + sampler:

```wgsl
@group(2) @binding(0) var prev_samp : sampler;
@group(2) @binding(1) var prev_tex  : texture_2d<f32>;

// in fs_main:
let prev = textureSample(prev_tex, prev_samp, uv).rgb * 0.94; // decay
```

This is how `feedback-trails` builds persistent trails. It's pure
WGSL — no manifest field, no WASM required.

### Presets (named parameter snapshots)

Packs can ship a `presets` array in `manifest.json`. Each preset is a
`{ name, values }` map; the panel renders a "preset" dropdown above the
sliders and applying one fans out via `setPackParameter` / persists.
Unknown keys are silently dropped; missing parameters fall back to the
manifest default. Useful for "looks the author intended" without making
the user discover them via slider tweaking.

```json
"presets": [
  { "name": "Calm",  "values": { "speed": 0.5, "tint": [0.8, 0.9, 1.0] } },
  { "name": "Wild",  "values": { "speed": 3.0, "tint": [1.0, 0.4, 0.1] } }
]
```

Preset names must be unique within a pack.

### Multi-pass post-FX chain

A pack can declare extra fragment passes that run *after* the main
shader, in sequence. Each pass samples the previous pass's color via
`@group(3)`. Last pass output is what the host treats as the pack's
final image (it flows into the existing crossfade rig).

Manifest:

```json
"passes": [
  { "shader": "bloom.wgsl" }
]
```

Each pass shader needs:

- `@group(0)` uniforms — same `Uniforms` struct as the main shader.
- `@group(1)` params — same `Params` struct, **if the pack declares any
  parameters at all**. Required for every pass in that case; pipeline
  creation fails otherwise.
- `@group(3) @binding(0/1)` — sampler + previous-pass texture.

Example bloom-pass header:

```wgsl
@group(3) @binding(0) var src_samp : sampler;
@group(3) @binding(1) var src_tex  : texture_2d<f32>;

@fragment
fn fs_main(@builtin(position) frag_pos: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = frag_pos.xy / u.resolution;
  let base = textureSample(src_tex, src_samp, uv).rgb;
  // ... blur / threshold / tone-map / whatever ...
  return vec4<f32>(base + glow, 1.0);
}
```

Constraints / gotchas:

- Extra passes don't get prev-frame feedback (`@group(2)`). That binding
  is reserved for pass 0 only.
- All passes share the host uniform buffer and the pack param buffer —
  they see the same audio features and parameter values for a given
  frame.
- Intermediate textures are allocated at full surface size and recreated
  on resize. There's one intermediate per extra pass.
- See `src/packs/bloom-pulse/` for a worked example (concentric rings
  base + brightness-threshold bloom).

### Tier 2 only: `pack.ts` (AssemblyScript)

```ts
let energy: f32 = 0.0;
let outputPtr: i32 = 0;

export function viz_pack_uniform_size(): u32 {
  return 16; // bytes; up to 336 max
}

export function viz_init(_featureCount: u32, _parameterCount: u32): u32 {
  const buf = new StaticArray<u8>(16);
  outputPtr = changetype<i32>(buf);
  energy = 0.0;
  return 1;
}

export function viz_frame(
  _handle: u32,
  timeMs: f32,
  featuresPtr: u32,
  _paramsPtr: u32,
): u32 {
  // Audio features: [rms, peak, bass, mid, treble, bpm, beat_phase, _pad]
  const bass: f32 = load<f32>(featuresPtr + 8);
  energy = energy * 0.96 + bass * 0.04;

  // Write whatever you want — must match the WGSL packData layout.
  store<f32>(outputPtr + 0, /* r */ <f32>0);
  store<f32>(outputPtr + 4, /* g */ <f32>0);
  store<f32>(outputPtr + 8, /* b */ <f32>0);
  store<f32>(outputPtr + 12, energy);

  return <u32>outputPtr;
}

export function viz_dispose(_handle: u32): void {}
```

Then update `package.json`'s `build:packs` script so the new `pack.ts`
gets compiled. The current script chains `bunx asc ...` invocations for
each Tier-2 pack (today: `wasm-color` and `particle-fountain`). Append
another `&& bunx asc src/packs/<id>/pack.ts --target release --runtime
stub --exportRuntime -o src/packs/<id>/pack.wasm`.

If the chain gets long, refactor to a loop:

```bash
"build:packs": "for d in src/packs/*/; do test -f \"$d/pack.ts\" && bunx asc \"$d/pack.ts\" --target release --runtime stub --exportRuntime -o \"$d/pack.wasm\"; done"
```

Run `bun run build:packs` from the repo root to compile.

## Step 4 — extend the WGSL struct for Tier 2

If the pack ships WASM, the WGSL struct must declare the pack-defined
region after `spectrum`:

```wgsl
struct Uniforms {
  // ... standard fields up through spectrum ...
  spectrum  : array<vec4<f32>, 8>,
  packData  : vec4<f32>,            // matches what pack.ts writes
};
```

Remember: the pack's output bytes are copied into the host uniform buffer
at offset 176 (right after `spectrum`). The WGSL struct picks them up
naturally because of WGSL's std140-ish alignment.

## Step 5 — test it

```
cd visualizer
bun run build:packs   # only needed for Tier 2
bun run dev
```

The new pack should appear in the dropdown alongside the built-ins.
Switch to it; confirm:
- Visuals render (no shader compile error in console).
- Audio features animate the visual.
- For Tier 2: the host log shows `[packs] WASM ready for "<id>"` and the
  visual reacts in ways that depend on WASM-computed values.

**Hot-reload (dev only).** While `bun run dev` is running, saving a
`.wgsl`, `manifest.json`, or `pack.wasm` under `src/packs/<id>/`
rebuilds that pack's pipeline within ~80 ms — no app restart needed.
The host logs `[packs] hot-reloaded "<id>" (...)` on success or warns
if revalidation fails (the previous version stays loaded). This watcher
only runs against the source tree, not against bundled `.app` builds.

## What NOT to do

- Don't use vertex buffers — the standard pipeline draws a single
  fullscreen triangle from `@builtin(vertex_index)`.
- Don't request additional bindings beyond `@group(0) @binding(0)` —
  the host only binds one uniform buffer per pack today.
- Don't write more than `viz_pack_uniform_size()` bytes from WASM (max
  336). The host clamps but it's wasted work.
- Don't depend on `host_log` for hot-path output — it round-trips through
  the host every call.

## Reference packs

When unsure, read these first:
- `src/packs/gradient/{manifest.json, shader.wgsl}` — clean Tier-1
  example showing the `parameters` manifest block and `@group(1)`
  binding (speed + warmth tint).
- `src/packs/plasma/shader.wgsl` — Tier-1 plasma effect with bass-driven
  hue swap.
- `src/packs/feedback-trails/shader.wgsl` — Tier-1 with prev-frame
  feedback (`@group(2)`). Beat-triggered starbursts smear into trails.
- `src/packs/fire/manifest.json` — example of `presets` (named
  parameter snapshots). `tunnel` ships them too.
- `src/packs/bloom-pulse/{manifest.json, shader.wgsl, bloom.wgsl}` —
  multi-pass example: pulse rings + a brightness-threshold bloom
  post-FX pass that samples the main pass via `@group(3)`.
- `src/packs/wasm-color/{pack.ts, shader.wgsl}` — minimal Tier-2 example;
  WASM produces RGB + accumulated energy each frame.
- `src/packs/particle-fountain/{pack.ts, shader.wgsl}` — Tier-2 with
  per-frame Verlet state (16 particles, beat-spawned, gravity + treble
  wind).

Browse `src/packs/` for the full set (~23 packs at last count) when
looking for a stylistic reference close to the user's seed.

## Distribution

To ship a pack outside this repo, zip the pack's directory with
`manifest.json` at the root (no wrapping folder; the importer also
accepts a single wrapper but root is cleaner). Rename the zip to
`<id>.viz`. Recipients install by either clicking **+** in the controls
panel and picking the file, **or** dragging the `.viz` onto the
controls window (drop overlay turns green; bytes are shipped to bun
via RPC and extracted into the user-packs directory).

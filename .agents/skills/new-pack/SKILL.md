---
name: new-pack
description: Scaffold a new visualizer pack for the Cat Nip project. Use when the user wants to create a new visualizer, write a custom shader, add a Tier 2 (WASM) pack, or asks how to add their own visuals to Cat Nip. Supports three authoring modes -- WGSL (native), GLSL (Shadertoy-convention, auto-transpiled to WGSL via Naga), and Tier 2 (WASM). Asks the user for the pack name + tier/language, then writes manifest.json, shader file, and (for Tier 2) pack.ts so it builds via `bun run build:packs`.
---

# Create a new visualizer pack

This skill scaffolds a new pack inside `packages/app/src/packs/<id>/`. Packs are the
unit of visualizer extensibility in this project. See `ARCHITECTURE.md`
(sibling of this skill in the repo) for the full contract.

## Step 1 — clarify with the user

Use `AskUserQuestion` to decide:

1. **Folder slug and display name** — folder slug is the directory name
   under `packages/app/src/packs/` (lowercase, `[a-z0-9_-]`, dev-only — the canonical
   pack id is the SHA-256 of the pack contents and is computed at load
   time, never written into `manifest.json`); name is the human-readable
   label shown in the dropdown.
2. **Shader language** — single-select:
   - **WGSL (native)** — the native shader language. Write `shader.wgsl`
     directly. Best when you need full control over bind groups, types,
     and WGSL-specific features.
   - **GLSL (Shadertoy convention)** — **recommended for LLM authoring**.
     Write `shader.glsl` using Shadertoy's `mainImage(out vec4, in vec2)`
     convention. The transpiler automatically converts to WGSL at load
     time via Naga. LLMs produce better GLSL than WGSL due to vastly
     more training data. Cat Nip audio uniforms (`bass`, `mid`, `treble`,
     `beat_phase`, `rms`, `peak`, `bpm`, `spectrum`) are available
     directly alongside Shadertoy aliases (`iTime`, `iResolution`,
     `iTimeDelta`).
3. **Tier** — single-select:
   - **Tier 1 (shader-only)** — recommended default. `manifest.json` +
     `shader.wgsl`/`shader.glsl`. Visualizers that depend only on
     host-provided audio features (rms, peak, bass/mid/treble, BPM, beat
     phase, FFT spectrum) and time fit this tier perfectly.
   - **Tier 2 (with WASM)** — adds a `pack.wasm` that computes per-frame
     custom uniforms in arbitrary code. Pick this when the visualizer
     needs state across frames (e.g. cumulative energy, scene timers,
     particle systems with non-deterministic motion). The shader must be
     WGSL (Tier 2 does not support GLSL shaders since the pack-specific
     uniform layout varies).
4. **Visual seed** — short free-text describing the look (e.g. "tunnel
   that pulses with bass", "spectrum bars only", "kaleidoscope"). Used
   to inform the shader template you write.
5. **Parameters** — propose 2–4 controls that fit the visual seed
   (speed, tint, density, intensity, mode toggle, etc.) and confirm with
   the user. Don't ship a pack with no knobs unless the user explicitly
   asks for a fixed-look pack. GLSL packs fully support `@group(1)`
   parameters — the transpiler auto-injects the `Params` uniform block
   when the manifest declares parameters.

If any of those are obvious from the conversation, skip asking.

## Step 2 — confirm the working directory

The packs directory lives at `<repo>/packages/app/src/packs/`. Verify it exists with
`ls`.

## Step 3 — scaffold files

### Always: `manifest.json`

For **WGSL** packs:
```json
{
  "schemaVersion": 1,
  "name": "<Name>",
  "version": "0.1.0",
  "author": "<author>",
  "description": "<one-sentence description>",
  "shader": "shader.wgsl"
}
```

For **GLSL** packs:
```json
{
  "schemaVersion": 1,
  "name": "<Name>",
  "version": "0.1.0",
  "author": "<author>",
  "description": "<one-sentence description>",
  "shader": "shader.glsl",
  "tags": ["glsl"]
}
```

The `"shader"` field accepts either `.wgsl` or `.glsl` extensions. When
the loader encounters a `.glsl` shader, it automatically transpiles it to
WGSL via the GLSL preprocessing + Naga pipeline before compiling.

Do **not** add an `id` field — pack identity is content-addressed
(SHA-256 of the canonical pack record) and computed by the loader. The
folder name is just an organizational handle for development.

For Tier 2, add `"wasm": "pack.wasm"` (Tier 2 requires WGSL shaders).

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

### For WGSL packs: `shader.wgsl`

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
`packages/app/src/packs/gradient/shader.wgsl` for the canonical block) by copy-paste.
Skip it if the user wants a clean fullscreen visual.

### For GLSL packs: `shader.glsl`

**Recommended when an LLM is writing the shader.** GLSL packs use the
Shadertoy convention — the entry point is `mainImage` and the transpiler
handles all the boilerplate (uniform block injection, vertex shader,
entry point wrapping).

Use this template:

```glsl
// <description of the visual>
//
// Shadertoy convention: iTime, iResolution, iTimeDelta are auto-defined.
// Cat Nip audio uniforms are directly available as globals:
//   bass, mid, treble, rms, peak, bpm, beat_phase, spectrum (vec4[8])

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = fragCoord / iResolution.xy;
    float t = iTime;

    // Audio-reactive parameters
    float energy = bass * 0.5 + mid * 0.3 + treble * 0.2;
    float pulse  = 0.8 + 0.2 * sin(beat_phase * 6.28318);

    // <-- replace with the actual visual idea -->
    float v = 0.0;
    v += sin(uv.x * 10.0 + t);
    v += sin(uv.y * 10.0 + t * 0.7);
    v += sin(length(uv - 0.5) * 10.0 * (1.0 + energy) - t * 0.9);
    v = v / 3.0 + 0.5;

    // Color palette
    vec3 col;
    col.r = 0.5 + 0.5 * cos(6.28318 * (v + 0.0));
    col.g = 0.5 + 0.5 * cos(6.28318 * (v + 0.33));
    col.b = 0.5 + 0.5 * cos(6.28318 * (v + 0.67));

    fragColor = vec4(col * pulse, 1.0);
}
```

#### What the transpiler provides automatically

When the loader encounters a `.glsl` shader, it runs it through
`glsl-preprocess.ts` → `naga-cli` → post-processing:

1. **`#version 450`** is prepended (required by Naga)
2. **Uniform block** is injected with explicit `layout(set=0, binding=0)`:
   ```glsl
   uniform Uniforms {
     float time_ms, delta_ms; vec2 resolution;
     float rms, peak, bass, mid, treble, bpm, beat_phase, _pad;
     vec4 spectrum[8];
   };
   ```
3. **Shadertoy aliases** are defined:
   - `iTime` → `time_ms / 1000.0`
   - `iResolution` → `vec3(resolution, 1.0)`
   - `iTimeDelta` → `delta_ms / 1000.0`
   - `iFrame` → `int(time_ms / 16.6667)` (approximate frame count)
   - `iMouse` → `vec4(0.0)` (no mouse in Cat Nip)
   - `iDate` → `vec4(0.0)` (stubbed)
   - `iSampleRate` → `44100.0`
4. **Cat Nip audio uniforms** are directly accessible as bare names:
   `bass`, `mid`, `treble`, `rms`, `peak`, `bpm`, `beat_phase`,
   `spectrum`
5. **`mainImage` wrapping** — the function is wrapped into `void main()`
   using `gl_FragCoord`
6. **Naga transpilation** — GLSL 450 → WGSL via the `naga` CLI
7. **Vertex shader** — the standard fullscreen triangle is prepended
8. **Entry point renaming** — Naga's output is post-processed so entry
   points are `vs_main` / `fs_main` and the uniform variable is `u`
   (matching native WGSL packs)
9. **Parameter block** — if the manifest declares `parameters`, a
   `layout(set=1, binding=0) uniform Params` block is injected with one
   `vec4` per parameter. Access as `speed.x`, `tint.xyz`, etc. After
   transpilation the WGSL uses `p.speed`, `p.tint`.
10. **Prev-frame feedback** — if the shader uses `prev_tex` /
    `prev_sampler`, `layout(set=2, ...)` bindings are auto-injected.
    Sample with `texture(sampler2D(prev_tex, prev_sampler), uv)`.
11. **Inter-pass input** — extra-pass shaders using `pass_tex` /
    `pass_sampler` get `layout(set=3, ...)` bindings auto-injected.

#### GLSL conventions and gotchas

- **Entry point**: Use `void mainImage(out vec4 fragColor, in vec2 fragCoord)`.
  If your shader uses `void main()` directly instead, the transpiler
  will handle that too (but `mainImage` is preferred for Shadertoy
  compat).
- **No `#version` needed**: The preprocessor adds `#version 450`
  automatically. Including your own won't break anything (duplicates
  are handled).
- **No uniform declarations needed**: The preprocessor injects the
  uniform block. If your GLSL already has a `uniform Uniforms` block,
  the preprocessor detects it and skips injection.
- **Shadertoy aliases are removed from user code**: If your source
  has `#define iTime` or similar, the preprocessor strips them to
  avoid conflicts with the injected aliases.
- **`mat2` fixup**: `mat2(cos(a), sin(a), -sin(a), cos(a))` is
  automatically rewritten to column-constructor form for Naga
  compatibility.
- **`mod()` on vectors**: Works as-is — Naga handles it.
- **`atan(y, x)`**: Works as-is — Naga converts to `atan2`.
- **`@group(1)` parameters**: Fully supported. Declare `parameters` in
  `manifest.json` and the preprocessor auto-injects the `Params` uniform
  block. Access them as `speed.x`, `tint.xyz`, etc. — they become `p.speed`,
  `p.tint` in the transpiled WGSL.
- **`@group(2)` prev-frame feedback**: Supported. Use `prev_tex` and
  `prev_sampler` in your GLSL — the preprocessor auto-detects them and
  injects the `layout(set=2, ...)` bindings. Sample with:
  ```glsl
  vec4 prev = texture(sampler2D(prev_tex, prev_sampler), uv);
  ```
- **`@group(3)` inter-pass**: Supported for multi-pass chains. Extra
  pass shaders can use `pass_tex` / `pass_sampler` — auto-injected
  when detected or when the `interPass` option is set.
- **Spectrum access**: The 32 FFT bins are packed in `spectrum[8]`
  (each vec4 holds 4 bins). Access individual bins with:
  ```glsl
  float bin = spectrum[idx / 4][idx % 4]; // idx = 0..31
  ```

#### When to use GLSL vs WGSL

| Scenario | Use |
|----------|-----|
| LLM is writing the shader | **GLSL** — vastly more training data |
| Porting a Shadertoy shader | **GLSL** — minimal changes needed |
| Need user-tunable parameters (`@group(1)`) | **Either** — GLSL auto-injects |
| Need prev-frame feedback (`@group(2)`) | **Either** — GLSL auto-detects |
| Need multi-pass post-FX chain (`@group(3)`) | **Either** — GLSL supported |
| Need Tier 2 WASM custom uniforms | **WGSL** |
| Maximum control over GPU pipeline | **WGSL** |

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
- See `packages/app/src/packs/bloom-pulse/` for a worked example (concentric rings
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
another `&& bunx asc packages/app/src/packs/<id>/pack.ts --target release --runtime
stub --exportRuntime -o packages/app/src/packs/<id>/pack.wasm`.

If the chain gets long, refactor to a loop:

```bash
"build:packs": "for d in packages/app/src/packs/*/; do test -f \"$d/pack.ts\" && bunx asc \"$d/pack.ts\" --target release --runtime stub --exportRuntime -o \"$d/pack.wasm\"; done"
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

### For GLSL packs: verify transpilation first

Before launching the app, verify the GLSL transpiles and compiles:

```bash
# Quick transpilation check — does Naga accept it?
# The loader does this automatically, but you can test manually:
bun -e "
  const { transpileGlslToWgsl } = require('./packages/app/src/bun/packs/glsl-transpile');
  const fs = require('fs');
  const glsl = fs.readFileSync('packages/app/src/packs/<slug>/shader.glsl', 'utf8');
  const result = transpileGlslToWgsl(glsl);
  if (!result.ok) { console.error('FAIL:', result.error); process.exit(1); }
  console.log('Transpiled OK (' + result.wgsl.length + ' chars)');
  fs.writeFileSync('/tmp/<slug>-transpiled.wgsl', result.wgsl);
"

# Then validate the transpiled WGSL compiles on the GPU:
bun packages/app/scripts/check-shader.ts --file /tmp/<slug>-transpiled.wgsl
```

If transpilation fails, common fixes:
- **Naga "uniform/buffer blocks require layout"**: The preprocessor
  should inject this; if your GLSL has its own `uniform` block, ensure
  it doesn't conflict.
- **Naga "Composing 0's component type"**: `mat2(a, b, c, d)` from
  scalars — the preprocessor fixes this, but nested expressions may
  confuse it. Rewrite to `mat2(vec2(a, b), vec2(c, d))` manually.
- **"Unknown function"**: Some GLSL built-ins aren't supported by Naga
  in constant expressions. Move them out of `const` declarations.

### For all packs: launch and verify

```
bun run build:packs   # only needed for Tier 2
bun run dev
```

The new pack should appear in the dropdown alongside the built-ins.
Switch to it; confirm:
- Visuals render (no shader compile error in console).
- Audio features animate the visual.
- For Tier 2: the host log shows `[packs] WASM ready for "<id>"` and the
  visual reacts in ways that depend on WASM-computed values.
- For GLSL: the host log shows the transpilation succeeded during load.

**Hot-reload (dev only).** While `bun run dev` is running, saving a
`.wgsl`, `.glsl`, `manifest.json`, or `pack.wasm` under `packages/app/src/packs/<id>/`
rebuilds that pack's pipeline within ~80 ms — no app restart needed.
The host logs `[packs] hot-reloaded "<id>" (...)` on success or warns
if revalidation fails (the previous version stays loaded). GLSL packs
are re-transpiled on each save. This watcher only runs against the source
tree, not against bundled `.app` builds.

## Step 6 — visual verification loop (headless screenshots)

After the pack scaffolding is complete, use the **screenshot-debug**
skill to take headless screengrabs and verify the output matches
expectations. This gives you a feedback loop without needing to launch
the full app.

### Basic check

Render a quick screenshot with defaults and inspect it:

```bash
bun packages/app/scripts/render-pack-debug.ts <slug> --width 640 --height 480 --frames 60
open /tmp/<slug>.png   # macOS
```

Look at the output. If the image is black, solid-color, or clearly
wrong, iterate on the shader and re-render.

### Iterate on the shader

Repeat this loop until the visual looks right:

1. Edit `shader.wgsl` or `shader.glsl` (or extra-pass shaders)
2. For GLSL: verify transpilation passes (see Step 5)
3. Re-render: `bun packages/app/scripts/render-pack-debug.ts <slug> --width 640 --height 480 --frames 60`
4. Inspect the output PNG
5. If wrong, go back to step 1

### Check parameter behavior

Verify that each parameter actually changes the output:

```bash
# Render with default params
bun packages/app/scripts/render-pack-debug.ts <slug> --out /tmp/<slug>-default.png

# Render with a parameter cranked to its extreme
bun packages/app/scripts/render-pack-debug.ts <slug> --param speed=4.0 --out /tmp/<slug>-fast.png
bun packages/app/scripts/render-pack-debug.ts <slug> --param speed=0.1 --out /tmp/<slug>-slow.png
```

If a parameter doesn't visibly change the output, the shader isn't
wired up correctly — fix the WGSL binding.

### Check temporal evolution

Use `--capture-frames` or `--time` to verify the visual changes over
time (not frozen):

```bash
bun packages/app/scripts/render-pack-debug.ts <slug> --capture-frames 0,30,60,90,119
```

Compare the captured frames — they should look different from each
other. If they're identical, the shader likely isn't using `time_ms`
or audio features.

### Check audio reactivity

Override audio features to verify the shader responds:

```bash
# High bass
bun packages/app/scripts/render-pack-debug.ts <slug> --audio bass=1.0 --audio rms=0.9 --out /tmp/<slug>-loud.png

# Silent
bun packages/app/scripts/render-pack-debug.ts <slug> --audio rms=0 --audio bass=0 --audio mid=0 --audio treble=0 --out /tmp/<slug>-silent.png
```

The loud vs silent renders should look noticeably different.

### Check presets

If the pack has presets, verify each one renders distinctly:

```bash
bun packages/app/scripts/render-pack-debug.ts <slug> --preset Calm --out /tmp/<slug>-calm.png
bun packages/app/scripts/render-pack-debug.ts <slug> --preset Wild --out /tmp/<slug>-wild.png
```

### Summary checklist

Before declaring the pack done, confirm:
- [ ] Default render produces a non-trivial visual (not black/solid)
- [ ] Each parameter visibly affects the output
- [ ] The visual changes over time (temporal evolution)
- [ ] Audio features (especially bass/rms) visibly affect the output
- [ ] Presets (if any) produce distinct looks
- [ ] No shader compilation errors in the output

## What NOT to do

- Don't use vertex buffers — the standard pipeline draws a single
  fullscreen triangle from `@builtin(vertex_index)`.
- Don't request additional bindings beyond `@group(0) @binding(0)` —
  the host only binds one uniform buffer per pack today.
- Don't write more than `viz_pack_uniform_size()` bytes from WASM (max
  336). The host clamps but it's wasted work.
- Don't depend on `host_log` for hot-path output — it round-trips through
  the host every call.
- Don't mix GLSL and Tier 2 WASM — GLSL packs can only be Tier 1
  (shader-only). The WASM custom uniform layout needs explicit WGSL
  struct declarations.
- Don't redeclare `layout(set=1, binding=0) uniform Params` in GLSL if
  the manifest already declares `parameters` — the preprocessor injects
  it automatically. If you do declare your own, the preprocessor detects
  it and skips injection.
- Don't add `#version` directives to GLSL packs — the preprocessor
  handles it. Adding one won't break anything but it's unnecessary noise.
- Don't declare your own `uniform Uniforms` block in GLSL — the
  preprocessor injects one. If you include your own, the preprocessor
  detects it and skips injection, but the layout must match exactly or
  the transpiled shader will have wrong offsets.

## Reference packs

When unsure, read these first:

### GLSL (Shadertoy convention)
- `packages/app/src/packs/glsl-plasma/{manifest.json, shader.glsl}` — **start here
  for GLSL packs.** Classic plasma effect using Shadertoy convention
  (`mainImage`, `iTime`, `iResolution`) plus Cat Nip audio uniforms
  (`bass`, `mid`, `treble`, `beat_phase`). Shows the minimal GLSL pack
  structure.

### WGSL (native)
- `packages/app/src/packs/gradient/{manifest.json, shader.wgsl}` — clean Tier-1
  example showing the `parameters` manifest block and `@group(1)`
  binding (speed + warmth tint).
- `packages/app/src/packs/plasma/shader.wgsl` — Tier-1 plasma effect with bass-driven
  hue swap.
- `packages/app/src/packs/feedback-trails/shader.wgsl` — Tier-1 with prev-frame
  feedback (`@group(2)`). Beat-triggered starbursts smear into trails.
- `packages/app/src/packs/fire/manifest.json` — example of `presets` (named
  parameter snapshots). `tunnel` ships them too.
- `packages/app/src/packs/bloom-pulse/{manifest.json, shader.wgsl, bloom.wgsl}` —
  multi-pass example: pulse rings + a brightness-threshold bloom
  post-FX pass that samples the main pass via `@group(3)`.

### Tier 2 (WASM)
- `packages/app/src/packs/wasm-color/{pack.ts, shader.wgsl}` — minimal Tier-2 example;
  WASM produces RGB + accumulated energy each frame.
- `packages/app/src/packs/particle-fountain/{pack.ts, shader.wgsl}` — Tier-2 with
  per-frame Verlet state (16 particles, beat-spawned, gravity + treble
  wind).

Browse `packages/app/src/packs/` for the full set (~36 packs at last count) when
looking for a stylistic reference close to the user's seed.

## Step 7 — build a `.viz` distribution archive

After the pack passes all checks, build a `.viz` file in the pack
directory so it can be imported into the app or shared:

```bash
# From the repo root — zip the pack contents (flat, no wrapping folder)
cd packages/app/src/packs/<slug> && zip -j <slug>.viz manifest.json shader.glsl  # or shader.wgsl
# For multi-pass packs, include extra pass shaders:
# cd packages/app/src/packs/<slug> && zip -j <slug>.viz manifest.json shader.glsl bloom.wgsl
# For Tier 2 packs, include the compiled WASM:
# cd packages/app/src/packs/<slug> && zip -j <slug>.viz manifest.json shader.wgsl pack.wasm
```

The `.viz` file is gitignored (`packages/app/src/packs/*/*.viz`).

To import: click **+** in the controls panel and pick the `.viz` file,
or drag it onto the controls window.

## Distribution

To ship a pack outside this repo, the `.viz` archive built in Step 7 is
the distribution format. It's a zip with `manifest.json` at the root
(no wrapping folder; the importer also accepts a single wrapper but root
is cleaner).

Recipients install by either clicking **+** in the controls panel and
picking the file, **or** dragging the `.viz` onto the controls window
(drop overlay turns green; bytes are shipped to bun via RPC and
extracted into the user-packs directory).

GLSL packs can be distributed as `.viz` archives containing the `.glsl`
source. The importer transpiles GLSL to WGSL during import and writes
the transpiled `.wgsl` file to the install directory. The recipient
does **not** need `naga-cli` installed — the importing app handles
transpilation.

## GLSL transpilation pipeline (internals)

For reference, the full GLSL → WGSL pipeline:

```
shader.glsl
  │
  ▼
glsl-preprocess.ts          ← injects #version 450, uniform block,
  │                            Shadertoy aliases, wraps mainImage,
  │                            fixes mat2 constructors, strips dupes
  ▼
naga CLI (GLSL 450 → WGSL)  ← Naga transpiles the preprocessed GLSL
  │
  ▼
post-processing              ← renames fn main → fs_main, renames
  │                            global. → u., prepends vertex shader
  ▼
final WGSL                   ← fed to createPackPipeline() like any
                                native WGSL pack
```

Key source files:
- `packages/app/src/bun/packs/glsl-preprocess.ts` — GLSL preprocessor
- `packages/app/src/bun/packs/glsl-transpile.ts` — transpiler orchestrator
- `packages/app/src/bun/paths.ts` — `findNagaBinary()` resolution
- `packages/app/src/bun/packs/loader.ts` — integration into pack loading
- `packages/app/src/bun/packs/import.ts` — integration into `.viz` import

---
name: screenshot-debug
description: Take headless screengrabs of a visualizer pack to debug visual output. Use when the user wants to see what a pack looks like, debug shader output, compare parameter values, or capture frames at specific times without launching the app.
---

# Screenshot Debug — Headless Pack Rendering

Use this skill whenever you need to **visually debug a pack's shader output** without launching the full application. The project has a headless rendering pipeline that runs wgpu without a window, generates deterministic synthetic audio, and writes PNG screenshots.

## Prerequisites

The headless renderer needs the bundled bun and native libraries from an electrobun build. If the user hasn't built yet, tell them to run one of:

```bash
# macOS (creates build/dev-macos-arm64/...app)
bunx electrobun dev

# Linux (downloads dist-linux-*)
bunx electrobun build --env=canary
```

The script auto-detects the bundle location.

## Quick Reference

### The Debug Script

```
bun scripts/render-pack-debug.ts <slug> [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--out <path>` | Output PNG path | `/tmp/<slug>.png` |
| `--width <n>` | Image width in pixels | 1024 |
| `--height <n>` | Image height in pixels | 768 |
| `--frames <n>` | Total frames to simulate | 120 (2s @ 60fps) |
| `--time <seconds>` | Capture at a simulated time (overrides `--frames`) | — |
| `--capture-frames <list>` | Comma-separated frame indices to capture mid-render | — |
| `--capture-times <list>` | Comma-separated times (seconds) to capture mid-render | — |
| `--capture-every <sec>` | Capture every N seconds (use with `--time` or `--frames`) | — |
| `--param <name>=<value>` | Override a pack parameter (repeatable) | manifest defaults |
| `--preset <name>` | Apply a named preset from the manifest | — |
| `--audio <key>=<value>` | Override a synthetic audio feature (repeatable) | `fakeFeatures()` |
| `--list-params` | Print pack's parameters and presets, then exit | — |
| `--list-packs` | Print all available pack slugs, then exit | — |

### The Simple Script (CI/quick use)

```
bun scripts/render-pack.ts <slug> [out.png]
```

No options — renders with manifest defaults, 120 frames, 1024x768. Env var overrides: `VIZ_RENDER_WIDTH`, `VIZ_RENDER_HEIGHT`, `VIZ_RENDER_FRAMES`.

### The Programmatic API

Both scripts call `renderPackToPng()` from `src/bun/packs/headless-render.ts`:

```ts
import { renderPackToPng } from "./src/bun/packs/headless-render";

await renderPackToPng({
  pack,                    // loaded Pack object
  outPath: "/tmp/out.png",
  width: 1024,             // optional, default 1024
  height: 768,             // optional, default 768
  frames: 120,             // optional, default 120
  paramOverrides: {        // optional — merged onto manifest defaults
    rings: 20,
    bloomAmt: 1.2,
  },
  audioOverrides: {        // optional — spread onto fakeFeatures() each frame
    bass: 1.0,
    treble: 0.0,
  },
  captureFrames: [0, 30, 60],  // optional — capture PNGs at these frame indices
});
```

## Common Workflows

### See what a pack looks like right now

Render the pack with all defaults and inspect the output:

```bash
bun scripts/render-pack-debug.ts <slug>
# opens /tmp/<slug>.png
open /tmp/<slug>.png    # macOS
xdg-open /tmp/<slug>.png  # Linux
```

### Render at a specific time

Use `--time` to simulate to a specific point. The renderer runs at 60fps, so `--time 3.5` renders 210 frames and captures the last one:

```bash
bun scripts/render-pack-debug.ts <slug> --time 3.5
```

This is useful for debugging time-dependent effects like beat-synced animations or oscillating patterns.

### Compare parameter values

First, list the pack's parameters to see what's available:

```bash
bun scripts/render-pack-debug.ts <slug> --list-params
```

Then render with overrides:

```bash
# Single parameter
bun scripts/render-pack-debug.ts bloom-pulse --param rings=24

# Multiple parameters
bun scripts/render-pack-debug.ts bloom-pulse --param rings=24 --param bloomAmt=1.5

# Color parameter (brackets optional)
bun scripts/render-pack-debug.ts bloom-pulse --param tint=[1,0,0]
bun scripts/render-pack-debug.ts bloom-pulse --param tint=1,0,0
```

### Apply a preset

```bash
bun scripts/render-pack-debug.ts bloom-pulse --preset Inferno
```

You can also layer `--param` overrides on top of a preset:

```bash
bun scripts/render-pack-debug.ts bloom-pulse --preset Inferno --param rings=8
```

### Capture a sequence of frames

Capture at specific frame indices to see how the visual evolves over time:

```bash
bun scripts/render-pack-debug.ts <slug> --capture-frames 0,30,60,90,119
```

This writes:
- `/tmp/<slug>_frame0.png`
- `/tmp/<slug>_frame30.png`
- `/tmp/<slug>_frame60.png`
- `/tmp/<slug>_frame90.png`
- `/tmp/<slug>_frame119.png`
- `/tmp/<slug>.png` (final frame, always written)

### Capture at specific times

Use `--capture-times` to capture at specific simulated times (in seconds). Frame counts are automatically extended to cover the latest time:

```bash
bun scripts/render-pack-debug.ts <slug> --capture-times 0,0.5,1.0,1.5,2.0
```

This writes time-stamped PNGs:
- `/tmp/<slug>_t0.0s.png`
- `/tmp/<slug>_t0.5s.png`
- `/tmp/<slug>_t1.0s.png`
- `/tmp/<slug>_t1.5s.png`
- `/tmp/<slug>_t2.0s.png`
- `/tmp/<slug>.png` (final frame, always written)

### Capture at regular intervals

Use `--capture-every` with `--time` for uniform temporal sampling:

```bash
bun scripts/render-pack-debug.ts <slug> --capture-every 0.5 --time 3.0
```

This captures at 0s, 0.5s, 1.0s, 1.5s, 2.0s, 2.5s, 3.0s — 7 frames total.

This is the recommended way to debug timing issues or verify temporal evolution. You can then diff sequential frames:

```bash
bun scripts/diff-png.ts /tmp/<slug>_t0.0s.png /tmp/<slug>_t1.0s.png
```

### Debug with specific audio features

Override the synthetic audio to test how a shader responds to particular audio conditions:

```bash
# Maximum bass, no treble
bun scripts/render-pack-debug.ts <slug> --audio bass=1.0 --audio treble=0

# Silent (all zeros)
bun scripts/render-pack-debug.ts <slug> --audio rms=0 --audio peak=0 --audio bass=0 --audio mid=0 --audio treble=0

# Specific BPM and beat phase
bun scripts/render-pack-debug.ts <slug> --audio bpm=140 --audio beat_phase=0.5
```

Valid audio keys: `rms`, `peak`, `bass`, `mid`, `treble`, `bpm`, `beat_phase`. Unspecified keys fall back to the default `fakeFeatures()` sinusoidal animation.

### Small/fast renders for iteration

For quick iteration, render at a smaller size with fewer frames:

```bash
bun scripts/render-pack-debug.ts <slug> --width 320 --height 240 --frames 30
```

### Combine everything

All options compose:

```bash
bun scripts/render-pack-debug.ts bloom-pulse \
  --preset Inferno \
  --param rings=8 \
  --audio bass=1.0 \
  --time 2.0 \
  --width 1920 --height 1080 \
  --capture-every 0.5 \
  --out /tmp/bloom-debug.png
```

## Understanding the Output

### Frame Timing

The headless renderer runs at a simulated 60fps. Each frame's elapsed time is:

```
elapsed_seconds = frame_index * (1000/60) / 1000
```

So frame 0 = 0.0s, frame 60 = 1.0s, frame 120 = 2.0s, etc.

### Synthetic Audio

When no `--audio` overrides are set, the renderer uses deterministic sinusoidal audio features from `fakeFeatures(elapsed)`:

| Feature | Formula |
|---------|---------|
| rms | `0.4 + 0.3 * sin(t * 1.5)` |
| peak | `0.7 + 0.3 * sin(t * 7)` |
| bass | `0.5 + 0.5 * max(0, sin(t * 2))` |
| mid | `0.5 + 0.5 * sin(t * 3.3 + 1)` |
| treble | `0.5 + 0.5 * sin(t * 6.1 + 2)` |
| bpm | `120` (constant) |
| beat_phase | `(t * 2) % 1` |

The spectrum is 32 log-spaced bins with animated per-bin sinusoids.

### Parameter Types

Pack parameters support these types in `--param` values:

| Type | Example `--param` value |
|------|------------------------|
| `float` | `--param gain=0.5` |
| `int` | `--param count=8` |
| `bool` | `--param enabled=true` |
| `enum` | `--param mode=additive` |
| `color` | `--param tint=[1,0.5,0.2]` or `--param tint=1,0.5,0.2` (RGB floats 0-1) |
| `range` | `--param freq=[0.2,0.8]` or `--param freq=0.2,0.8` |
| `vec2` | `--param offset=[0.5,0.5]` or `--param offset=0.5,0.5` |
| `vec3` | `--param pos=[1,2,3]` or `--param pos=1,2,3` |
| `vec4` | `--param col=[1,0,0,1]` or `--param col=1,0,0,1` |

## Key Files

| File | Role |
|------|------|
| `scripts/render-pack-debug.ts` | Debug CLI with full parameter/audio/timing control |
| `scripts/render-pack.ts` | Simple CI CLI (defaults only, env-var overrides) |
| `src/bun/packs/headless-render.ts` | Core `renderPackToPng()` — the shared rendering engine |
| `src/bun/engine/feature-smoother.ts` | `fakeFeatures()` and `fakeSpectrum()` — synthetic audio |
| `src/bun/packs/parameters.ts` | Parameter coercion, packing, and default values |
| `src/bun/packs/loader.ts` | Pack loading and manifest validation |
| `src/bun/gpu/renderer.ts` | `createHeadlessRenderer()` — no-window GPU init |
| `src/bun/gpu/pipeline.ts` | Pack shader pipeline construction |

## Troubleshooting

### "no electrobun bundle found"

Run `bunx electrobun dev` (macOS) or `bunx electrobun build --env=canary` (Linux) to generate the native library bundle. The renderer needs the bundled `bun`, `libwebgpu_dawn`, and `libNativeWrapper` to initialize wgpu.

### Black or empty output

- The pack may need more frames to produce visible output (some packs use `prev_frame` feedback that builds up over time). Try `--frames 300` or `--time 5`.
- Check if the pack has required parameters that default to zero. Use `--list-params` to inspect defaults.
- On CI/Linux, ensure `VK_ICD_FILENAMES` points at lavapipe's ICD JSON for software Vulkan.

### "unknown parameter" error

Use `--list-params` to see the exact parameter names and types for a pack. Parameter names must match the manifest exactly (case-sensitive).

### Slow rendering

Software Vulkan (lavapipe) is slow. For iteration, use `--width 320 --height 240 --frames 30`. Hardware GPU renders are much faster.

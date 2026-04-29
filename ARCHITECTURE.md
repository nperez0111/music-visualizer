# music-visualizer architecture

This document explains how the project is structured, how a frame gets
rendered, and the contracts between subsystems. Read [README.md](./README.md)
first if you just want to use the app.

## High-level diagram

```
+--------------------- Bun main process (src/bun/index.ts) ------------------+
|                                                                            |
|  +------------------+   +-------------------+   +----------------------+   |
|  | audiotap         |   | wgpu-native FFI   |   | pack registry        |   |
|  | (Swift child)    |---> ring buffer       |   | - load from disk     |   |
|  | system audio     |   | + FFT analyzer    |   | - WASM runtime       |   |
|  | -> framed PCM    |   | features+spectrum |   | - import .viz        |   |
|  +------------------+   +---------+---------+   +----------+-----------+   |
|                                   |                        |               |
|                                   v                        v               |
|                         +------------------- frame loop ----+              |
|                         | gather features                  |               |
|                         | smooth (EMA)                     |               |
|                         | write uniforms (std + WASM)      |               |
|                         | render pack -> target A          |               |
|                         | (during transition)              |               |
|                         |   render to-pack -> target B     |               |
|                         | composite -> swapchain           |               |
|                         | submit + present                 |               |
|                         +----------------+-----------------+               |
|                                          |                                 |
|                                          v                                 |
|                                  GpuWindow (visualizer)                    |
|                                                                            |
|  +------------- bun:sqlite (~/Library/.../visualizer.db) -------------+    |
|  |  preferences (key,value JSON)                                      |    |
|  +--------------------------------------------------------------------+    |
+----------------------|----------------------------------------|------------+
                       | defineRPC                              |
                       v                                        |
         +---- BrowserWindow (controls overlay) ------+         |
         |  HTML/CSS/JS, transparent, frameless,      |         |
         |  always-on-top                             |         |
         |  - pack dropdown                           |         |
         |  - audio level meter                       |         |
         |  - import .viz button                      |         |
         |  - pointer-driven window drag              |         |
         +--------------------------------------------+         |
                                                                |
   user packs at ~/Library/Application Support/.../packs/ <-----+
```

## Process model

The app runs as **two macOS windows** owned by the same Bun process:

- **`GpuWindow`** — visualizer surface. Rendering happens in the Bun main
  process via `bun:ffi` against `WGPU.native.symbols` (Dawn / wgpu-native).
- **`BrowserWindow`** — controls overlay. HTML/CSS/JS in WKWebView,
  always-on-top, transparent, frameless. Talks to Bun via Electrobun's
  `defineRPC`.

These are technically two NSWindows but the controls window doesn't render
the visualizer — it only sends control messages and displays state. All
audio capture, GPU work, pack loading, and persistence happens in Bun.

> **Why not one window?** Electrobun's `BrowserView` add-path explicitly
> looks up `BrowserWindow.getById(windowId)` only — it can't attach to a
> `GpuWindow`. So the controls necessarily live in a sibling window. We
> tried `passthrough: true` (per-pixel hit testing) but it's window-level,
> not per-pixel; clicks on the panel were eaten too.

## File layout

```
src/
├── bun/                      # main process
│   ├── index.ts              # entry point: windows, frame loop, RPC
│   ├── gpu/
│   │   ├── wgpu-helpers.ts   # WGPU descriptor builders + constants
│   │   ├── renderer.ts       # instance/adapter/device/queue/surface
│   │   ├── pipeline.ts       # createPackPipeline (one per pack)
│   │   └── transition.ts     # A/B render targets + composite shader
│   ├── audio/
│   │   ├── capture.ts        # spawns audiotap, parses framed PCM
│   │   ├── ring-buffer.ts    # mono Float32 circular buffer
│   │   └── analysis.ts       # Hann FFT, energy bands, simple BPM
│   ├── packs/
│   │   ├── loader.ts         # scan dirs, validate manifests
│   │   ├── runtime.ts        # WASM ABI host runtime
│   │   └── import.ts         # .viz extraction (zip via fflate)
│   └── db/
│       └── index.ts          # bun:sqlite open + preferences KV
│
├── mainview/                 # controls window webview
│   ├── index.html
│   ├── index.css
│   └── index.ts              # RPC, dropdown, drag, meter
│
├── native/audiotap/          # Swift CLI: ScreenCaptureKit -> framed PCM
│   ├── Package.swift
│   └── Sources/audiotap/...
│
└── packs/                    # built-in packs
    ├── gradient/{manifest.json, shader.wgsl}
    ├── plasma/{manifest.json, shader.wgsl}
    └── wasm-color/{manifest.json, shader.wgsl, pack.ts, pack.wasm}
```

## Render path

### Renderer bootstrap (`gpu/renderer.ts`)

`createRenderer(window)` calls into `WGPU.native` and `WGPUBridge` to get
an `instance`, an `adapter`, a `device`, a `queue`, and a `surface` bound
to the `GpuWindow`'s native view. Surface format is queried from
capabilities (typically `BGRA8Unorm` on macOS).

### Pipeline cache (`gpu/pipeline.ts`)

Each pack's WGSL is compiled into its own pipeline (one shader module +
render pipeline + bind group). All packs share a single 512-byte uniform
buffer; their bind groups bind that buffer at `@group(0) @binding(0)`.
Pipelines are cached by pack id.

### A/B render targets and composite (`gpu/transition.ts`)

Two offscreen textures (`targetA`, `targetB`) at swapchain size, recreated
on resize. A second pipeline (the **composite shader**, defined inline in
`transition.ts`) reads both as `texture_2d<f32>` plus a small uniform
buffer (mix factor + resolution) and writes to the swapchain.

Frame logic:

```
if not transitioning:
   render activePack -> targetA
   composite(swapView, mix=0)        // returns texture A unchanged
else:
   render fromPack -> targetA
   render toPack   -> targetB
   composite(swapView, mix=t)        // smoothstep(0,1,t)
   if t >= 1: activePack = toPack; transition done
```

### Uniform buffer layout

| Offset | Bytes | Field            | Provided by                |
|-------:|------:|------------------|----------------------------|
|      0 |     4 | `time_ms`        | host                       |
|      4 |     4 | `delta_ms`       | host                       |
|      8 |     8 | `resolution`     | host                       |
|     16 |     4 | `rms`            | host (FFT analyzer or fake)|
|     20 |     4 | `peak`           | host                       |
|     24 |     4 | `bass`           | host                       |
|     28 |     4 | `mid`            | host                       |
|     32 |     4 | `treble`         | host                       |
|     36 |     4 | `bpm`            | host                       |
|     40 |     4 | `beat_phase`     | host                       |
|     44 |     4 | `_pad`           | host                       |
|     48 |   128 | `spectrum[8]`    | host (32 log-spaced bins)  |
|    176 |   336 | pack-defined     | Tier 2 WASM (else zeros)   |

WGSL packs declare a struct that matches what they actually use; the GPU
ignores any bytes the struct doesn't reach.

## Audio path

### Capture (`src/native/audiotap/`)

A small Swift CLI that uses ScreenCaptureKit:

1. Requests a single-display `SCContentFilter`.
2. Opens an `SCStream` with `capturesAudio = true` and a tiny 2×2 video
   output (SCKit refuses audio-only streams).
3. On each `CMSampleBuffer`, writes a binary frame to **stdout**:
   ```
   u32 LE  magic = 0xA1D10A1D
   u32 LE  channels
   u32 LE  sampleRate
   u32 LE  frameCount
   f32 LE * channels * frameCount   (interleaved if stereo)
   ```
4. Emits newline-delimited JSON status events on **stderr**:
   `{"type":"ready"}`, `{"type":"started",...}`, `{"type":"stopped"}`,
   `{"type":"permission-denied"}`, `{"type":"error", "message":"..."}`.

### Bun-side reader (`bun/audio/capture.ts`)

`Bun.spawn(["./audiotap"])`. Two readers run concurrently:

- **stdout**: streaming binary parser. Carries pending bytes between
  reads; emits frames as they complete; resyncs on a one-byte slip if the
  magic doesn't match.
- **stderr**: line-delimited JSON; updates capture status; surfaces
  permission errors to the UI.

Each PCM frame is written to a 4096-sample mono ring buffer (stereo →
mono mixdown on write).

### Analysis (`bun/audio/analysis.ts`)

Once per render frame:

1. Pull most recent 1024 samples from the ring buffer.
2. RMS / peak directly from time domain.
3. Apply Hann window, run radix-2 Cooley-Tukey FFT.
4. Compute magnitude spectrum, then derive band energies (bass 20-200 Hz,
   mid 200-2000 Hz, treble 2-12 kHz) and a 32-bin log-spaced
   display spectrum.
5. Spectral-flux onset detector → autocorrelation BPM estimate
   (60-200 BPM clamp) → `beat_phase` ∈ [0, 1).

Features and spectrum are EMA-smoothed (α≈0.2 for features, α≈0.35 for
spectrum) before the shader sees them, to remove frame-to-frame jitter
without losing beat-flash snap.

## Pack format

### Tier 1 — shader-only

```
my-pack/
├── manifest.json
└── shader.wgsl
```

`shader.wgsl` declares the standard `Uniforms` struct (see
"Uniform buffer layout" above) and exports `vs_main` (vertex) + `fs_main`
(fragment). The vertex shader uses `@builtin(vertex_index)` to emit a
fullscreen triangle from no vertex buffer.

### Tier 2 — adds WASM

```
my-pack/
├── manifest.json    # has "wasm": "pack.wasm"
├── shader.wgsl      # struct includes pack-defined uniforms after spectrum
└── pack.wasm
```

Each frame the host calls into the WASM module, hands it audio features,
and copies its output bytes into the uniform buffer at offset 176.

#### WASM ABI v1

Pack exports (host probes for presence):

| Symbol                  | Signature                                                    | Required |
|-------------------------|--------------------------------------------------------------|---------|
| `viz_pack_uniform_size` | `() -> u32`                                                  | yes     |
| `viz_init`              | `(audioFeatureCount: u32, parameterCount: u32) -> u32` (handle) | yes |
| `viz_frame`             | `(handle: u32, timeMs: f32, featuresPtr: u32, paramsPtr: u32) -> u32` (offset of output bytes) | yes |
| `viz_dispose`           | `(handle: u32)`                                              | optional |
| `memory`                | (auto-exported by AS)                                        | yes     |

Host imports (under `env`):

| Symbol         | Signature                          | Purpose                  |
|----------------|------------------------------------|--------------------------|
| `host_log`     | `(ptr: u32, len: u32)`             | UTF-8 debug log          |
| `host_random`  | `() -> f32`                        | uniform `[0, 1)`         |
| `host_now_ms`  | `() -> f32`                        | high-res clock           |
| `abort`        | AS-prerequisite                    | best-effort              |

Audio features are written by the host before each `viz_frame` call as 8
consecutive `f32`s at `featuresPtr` in pack memory:
`rms, peak, bass, mid, treble, bpm, beat_phase, _pad`.

The pack writes its custom uniforms (`<= viz_pack_uniform_size()` bytes,
max 336) anywhere in linear memory and returns the offset. The host
copies those bytes into the GPU-bound uniform buffer at offset 176.

#### Forward compatibility

- **Optional exports** — host probes `instance.exports.viz_<name>` at load
  time. New entry points (e.g. future `viz_pointer_event`,
  `viz_compute`, `viz_resize`) can be added without breaking older packs.
- **Always-provided imports** — the host's import table can grow freely;
  packs only declare what they need.

## Persistence

A single SQLite file at
`~/Library/Application Support/music-visualizer.electrobun.dev/visualizer.db`,
managed by `bun:sqlite` with `journal_mode = WAL`.

Schema (current):

```sql
CREATE TABLE preferences (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL  -- JSON-encoded
);
```

Known keys:

| Key                              | Value                                  |
|----------------------------------|----------------------------------------|
| `window.visualizer.bounds`       | `{x,y,width,height}`                   |
| `window.controls.position`       | `{x,y}`                                |
| `window.controls.expandedSize`   | `{width,height}`                       |
| `window.controls.collapsed`      | `boolean`                              |
| `active.pack.id`                 | `string`                               |

User packs are extracted to
`~/Library/Application Support/.../packs/<id>/` — that directory is the
source of truth. The DB indexes preferences only; user packs are picked
up by scanning the directory at startup. (A `packs` table for richer
metadata is a future addition.)

## IPC

`Electrobun.BrowserView.defineRPC` provides typed bidirectional RPC
between Bun and the controls webview. Schema lives in `src/bun/index.ts`
(definition) and `src/mainview/index.ts` (consumer copy).

Bun-side:

- **Requests** (webview → bun): `getInitialState`, `getControlsPosition`,
  `listPacks`, `importPack`.
- **Messages** (webview → bun): `setCollapsed`, `setControlsPosition`,
  `setActivePack`, `removePack`.

Webview-side:

- **Messages** (bun → webview): `audioStatus`, `audioLevel`,
  `activePackChanged`, `packsChanged`.

## Frame loop (sequence)

```
every ~16 ms:
  1.  resolve window size; reconfigure surface and transition rig
  2.  pull audio features + spectrum (FFT or fake)
  3.  EMA-smooth them
  4.  if active pack is Tier 2: run WASM viz_frame, copy bytes -> uniform staging at offset 176
  5.  uploadBuffer(uniformBuffer, staging)
  6.  surfaceGetCurrentTexture -> swap view
  7.  encode pass A: render activePack (or fromPack if transitioning) -> targetA
  8.  if transitioning: encode pass B: render toPack -> targetB
  9.  encode composite pass: sample targetA + targetB by mix(t) -> swap view
 10.  finish encoder, queueSubmit, surfacePresent, release transient resources
```

If `viz_frame` throws, the WASM error is caught and the pack-uniform
region stays zeroed for that frame — non-fatal.

## Lifetimes and `KEEPALIVE`

WGPU descriptor structs are built as `ArrayBuffer`s and passed to FFI by
pointer. After the FFI call returns, the descriptor's data has typically
been consumed. For descriptors used at pipeline-creation time, we push
their backing buffers onto a `KEEPALIVE: any[]` array tied to the
pipeline's lifetime, so GC doesn't collect them mid-call. Per-frame
descriptors (color attachment, render pass desc) are short-lived and
don't need keepalive — they're alive for the synchronous duration of the
encode call.

## Build and run

| Command                  | What it does                                      |
|--------------------------|---------------------------------------------------|
| `bun install`            | Pulls Electrobun + AssemblyScript + fflate.       |
| `bun run build:audiotap` | Builds the Swift system-audio helper (universal). |
| `bun run build:packs`    | Compiles the AssemblyScript sample to `pack.wasm`.|
| `bun run dev`            | Electrobun dev mode — bundles + opens windows.    |

The `electrobun.config.ts` `copy` block ships:
- `views/mainview/{index.html,index.css}` (controls UI)
- `audiotap` (Swift binary) → `Resources/app/audiotap`
- `packs/` → `Resources/app/packs/`

The audiotap binary is located at runtime by checking
`<cwd>/../Resources/app/audiotap` (production), `<bundled>/audiotap` (dev),
and a repo-relative fallback. Built-in packs have analogous candidate paths
(see `loader.ts:findBuiltinPacksDir`).

## Known constraints / artifacts

- **Tier-2 → Tier-2 crossfade** writes only one pack's custom uniforms per
  frame (currently the "from" pack). The "to" pack reads stale `packData`
  for the duration. Acceptable v1 artifact; per-pack uniform buffers fix it.
- **Single-display SCKit filter.** The audio capture uses the first display
  only. On multi-display setups, audio mix is whatever that one display's
  context is — usually fine, but worth knowing.
- **Spectrum strip duplication.** Each built-in pack ships its own copy of
  the bottom-strip bars. A host overlay pass would centralize this.

See [FUTURE.md](./FUTURE.md) for the full roadmap.

# @catnip/app

The Cat Nip desktop application -- a real-time music visualizer built on [Electrobun](https://electrobun.dev). It captures system audio (or microphone input), performs FFT analysis, and renders shader-based visualizer "packs" at 60 fps using wgpu-native via `bun:ffi`.

The app ships as a single-window Electrobun application. A native GPU overlay (`<electrobun-wgpu>`) fills the window with rendered visuals while a collapsible HTML/CSS sidebar provides controls for pack selection, audio source, parameters, and `.viz` file import. All heavy work -- audio capture, FFT, GPU rendering, pack loading, and WASM execution -- runs in the Bun main process. The webview is a thin control surface connected over typed RPC.

## Architecture

```
Bun main process
  |
  +-- audiocap (Rust child process, cpal loopback/mic)
  |     writes framed PCM to stdout, status JSON to stderr
  |
  +-- Audio pipeline
  |     capture.ts -> ring buffer -> FFT analyzer
  |     produces: rms, peak, bass, mid, treble, bpm, beat_phase, spectrum[32]
  |
  +-- GPU pipeline (bun:ffi -> wgpu-native)
  |     renderer.ts    surface + device bootstrap
  |     pipeline.ts    per-pack shader module + render pipeline + bind group
  |     transition.ts  A/B render targets + composite shader for crossfades
  |
  +-- Engine (orchestration)
  |     render-frame.ts      per-frame driver (tick, render, composite, present)
  |     pipeline-cache.ts    caches compiled pipelines by pack id
  |     transitions.ts       crossfade state machine
  |     feature-smoother.ts  EMA smoothing of audio features
  |     uniform-writer.ts    packs the 16 KB uniform buffer each frame
  |
  +-- Pack system
  |     loader.ts       discovers built-in + user packs, validates manifests
  |     registry.ts     owns pack list, parameter state, hot-reload watcher
  |     runtime.ts      Tier 2 WASM instantiation + per-frame execution
  |     import.ts       .viz file import (decompress + validate + install)
  |     glsl-preprocess.ts + glsl-transpile.ts   GLSL -> WGSL transpilation
  |
  +-- Persistence (bun:sqlite)
  |     preferences table (window bounds, active pack, audio source, etc.)
  |
  +-- RPC (Electrobun BrowserView.defineRPC)
        webview <-> bun typed messages defined in src/shared/rpc-types.ts

Webview (single BrowserWindow, hiddenInset titlebar)
  +-- <electrobun-wgpu>   native GPU overlay, click-through on sidebar
  +-- <aside .sidebar>    pack dropdown, audio meter, parameters, import
```

## Key directories and files

| Path | Description |
|------|-------------|
| `electrobun.config.ts` | App metadata, build config, copy rules, platform settings |
| `src/bun/index.ts` | Main process entry point: window creation, RPC handlers, frame loop |
| `src/shared/rpc-types.ts` | Single source of truth for all RPC type contracts (bun <-> webview) |
| `src/bun/audio/capture.ts` | Spawns audiocap binary, parses framed PCM from stdout |
| `src/bun/audio/ring-buffer.ts` | Lock-free ring buffer for PCM samples |
| `src/bun/audio/analysis.ts` | FFT, band energy, BPM detection, spectrum binning |
| `src/bun/gpu/renderer.ts` | wgpu-native bootstrap (instance, adapter, device, surface) |
| `src/bun/gpu/pipeline.ts` | Per-pack shader compilation and bind group creation |
| `src/bun/gpu/transition.ts` | A/B offscreen render targets and composite shader |
| `src/bun/gpu/wgpu-helpers.ts` | Low-level WGPU descriptor builders |
| `src/bun/gpu/electrobun-gpu.ts` | Re-exports Electrobun WGPU + WGPUBridge symbols |
| `src/bun/engine/render-frame.ts` | Per-frame render driver (tick, encode, present) |
| `src/bun/engine/pipeline-cache.ts` | Caches compiled GPU pipelines by pack id |
| `src/bun/engine/transitions.ts` | Crossfade state machine |
| `src/bun/engine/feature-smoother.ts` | EMA smoothing for audio features |
| `src/bun/engine/uniform-writer.ts` | Packs the 16 KB uniform buffer (host scalars + spectrum + WASM data) |
| `src/bun/packs/loader.ts` | Pack discovery, manifest validation, shader loading |
| `src/bun/packs/registry.ts` | In-memory pack list, parameter persistence, hot-reload |
| `src/bun/packs/runtime.ts` | WASM pack instantiation and per-frame ABI calls |
| `src/bun/packs/import.ts` | `.viz` file import (fflate decompress + validation) |
| `src/bun/packs/glsl-preprocess.ts` | GLSL Shadertoy-convention preprocessor |
| `src/bun/packs/glsl-transpile.ts` | GLSL -> WGSL transpilation via Naga CLI |
| `src/bun/packs/parameters.ts` | Pack parameter coercion and default values |
| `src/bun/db/index.ts` | SQLite preferences (bun:sqlite, WAL mode) |
| `src/bun/paths.ts` | Runtime path resolution (audiocap binary, packs dir, naga) |
| `src/bun/window-prefs.ts` | Window bounds persistence |
| `src/mainview/index.{html,css,ts}` | Webview UI: sidebar controls, pack dropdown, audio meter |
| `src/packs/` | Built-in visualizer packs (manifest.json + shader.wgsl/glsl each) |
| `src/native/audiocap/` | Rust crate: cpal-based system audio / mic capture |
| `scripts/` | Build and utility scripts (see below) |

## How to run

All commands run from the **monorepo root** unless noted.

### Prerequisites

- [Bun](https://bun.sh) (latest)
- [Rust + rustup](https://rustup.rs/) (for building audiocap -- Homebrew rust alone is not sufficient on macOS, as the build produces a universal arm64+x86_64 binary via lipo)
- [Naga CLI](https://github.com/gfx-rs/wgpu) (for GLSL -> WGSL transpilation; install via `cargo install naga-cli`)

### Install dependencies

```sh
bun install
```

### Build the audio capture binary

```sh
bun run build:audiocap
```

Produces `packages/app/src/native/audiocap/audiocap`. On macOS this is a universal binary (arm64 + x86_64).

### Build WASM packs (Tier 2)

```sh
bun run build:packs
```

Compiles AssemblyScript pack sources to `.wasm`.

### Run in dev mode

```sh
bun run dev
```

Electrobun dev mode: bundles the Bun and webview entry points, copies assets, and opens the app window with hot-reload.

### Build for distribution

```sh
bun run build:canary
```

Produces a signed and notarized app bundle (macOS).

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/build-audiocap.ts` | Builds the Rust audiocap binary |
| `scripts/build-packs.ts` | Compiles AssemblyScript WASM packs |
| `scripts/render-pack.ts` | Headless pack render (CI -- produces a PNG screenshot) |
| `scripts/render-pack-debug.ts` | Headless pack render (debug, interactive) |
| `scripts/check-shader.ts` | Validates WGSL shader compilation without a full render |
| `scripts/diff-png.ts` | Pixel-by-pixel PNG comparison |
| `scripts/test-packs-gpu.ts` | GPU-based pack test suite |
| `scripts/stress-test-transpiler.ts` | Stress test for GLSL -> WGSL transpilation |

## Dependencies

### Runtime

| Dependency | Purpose |
|------------|---------|
| `electrobun` | Desktop app framework (window management, native WGPU views, RPC) |
| `@catnip/shared` | Shared manifest types, validation, hashing (workspace package) |
| `fflate` | Compression/decompression for `.viz` pack files |
| `pixelmatch` / `pngjs` | PNG comparison for headless render tests |
| `wasm-webp` | WebP encoding for gallery screenshots |
| `@atcute/client` | AT Protocol client for registry integration |

### Dev / build

| Dependency | Purpose |
|------------|---------|
| `assemblyscript` | Compiles Tier 2 pack TypeScript to WASM |
| `@types/bun` | Bun type definitions |
| `@atcute/atproto` | AT Protocol type definitions |

### Native tooling

| Tool | Purpose |
|------|---------|
| Rust + cpal | System audio capture (audiocap binary) |
| Naga CLI | GLSL 450 -> WGSL shader transpilation |
| wgpu-native | GPU rendering (bundled by Electrobun) |

## Testing

```sh
# Run all app tests
bun run test:app

# Run all tests across the monorepo
bun test

# GPU-based pack rendering tests
bun run test:gpu
```

Test files are co-located with their source:

- `src/bun/packs/loader.test.ts` -- pack discovery and manifest validation
- `src/bun/packs/import.test.ts` -- `.viz` file import
- `src/bun/packs/runtime.test.ts` -- WASM pack runtime
- `src/bun/packs/glsl-preprocess.test.ts` -- GLSL preprocessor
- `src/bun/packs/glsl-transpile.test.ts` -- GLSL -> WGSL transpilation
- `src/packs/packs.test.ts` -- built-in pack manifest validation
- `src/packs/render.test.ts` -- headless rendering of built-in packs

## Platform notes

- **macOS**: Requires macOS 14.2+ for CoreAudio process tap (system audio loopback). The user must grant "System Audio" permission in System Settings > Privacy -- the legacy "Screen Recording" permission is not sufficient and will result in silent capture.
- **Windows**: WASAPI loopback, no permission prompt required.
- **Linux**: PulseAudio or PipeWire monitor source.

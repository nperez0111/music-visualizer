# Agent Instructions

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the full system design. Keep both files up to date when making changes.

## Monorepo layout

```
packages/
  app/        Electrobun desktop visualizer
  shared/     Manifest types, validation, hashing, limits
  lexicons/   AT Protocol lexicon schemas + generated TypeScript
  cli/        CLI tool (catnip)
  server/     Nitro server (website + API + indexer)
```

## Build commands

All commands run from the repo root unless noted.

| Command | What |
|---------|------|
| `bun run dev` | Dev mode — desktop app (Electrobun bundles + opens windows) |
| `bun run build:audiocap` | Build Rust audio helper -> `packages/app/src/native/audiocap/audiocap` |
| `bun run build:packs` | Compile AssemblyScript WASM packs |
| `bun test` | Run all tests across the monorepo |
| `bun run test:app` | Run desktop app tests only |
| `bun run dev:server` | Dev mode — registry server |
| `bun run typecheck` | Type-check with native `tsgo --build` (pre-existing errors in GPU FFI + AssemblyScript files are expected; filter for your changed files) |
| `bun run lint` | Lint with oxlint (type-aware, config in `.oxlintrc.json`). Fix all warnings before committing. |

## Where to find things

| Area | Key files |
|------|-----------|
| **App entry + RPC wiring** | `packages/app/src/bun/index.ts` |
| **RPC type contracts** | `packages/app/src/shared/rpc-types.ts` |
| **Audio capture (Rust)** | `packages/app/src/native/audiocap/src/main.rs` |
| **Audio capture (TS)** | `packages/app/src/bun/audio/capture.ts` |
| **Audio analysis (FFT, beats)** | `packages/app/src/bun/audio/analysis.ts` |
| **Ring buffer** | `packages/app/src/bun/audio/ring-buffer.ts` |
| **GPU renderer** | `packages/app/src/bun/gpu/renderer.ts` |
| **Pack pipeline** | `packages/app/src/bun/gpu/pipeline.ts` |
| **Transition compositing** | `packages/app/src/bun/gpu/transition.ts` |
| **Pack loader + manifest** | `packages/app/src/bun/packs/loader.ts` |
| **WASM pack runtime** | `packages/app/src/bun/packs/runtime.ts` |
| **.viz import** | `packages/app/src/bun/packs/import.ts` |
| **DB / preferences** | `packages/app/src/bun/db/index.ts` |
| **Path resolution** | `packages/app/src/bun/paths.ts` |
| **Controls UI** | `packages/app/src/mainview/index.html`, `index.css`, `index.ts` |
| **Built-in packs** | `packages/app/src/packs/<name>/manifest.json` + `shader.wgsl` (or `shader.glsl`) |
| **GLSL preprocessor** | `packages/app/src/bun/packs/glsl-preprocess.ts` |
| **GLSL→WGSL transpiler** | `packages/app/src/bun/packs/glsl-transpile.ts` |
| **Build scripts** | `packages/app/scripts/build-audiocap.ts`, `packages/app/scripts/build-packs.ts` |
| **Headless pack render** | `packages/app/scripts/render-pack.ts` (CI), `packages/app/scripts/render-pack-debug.ts` (debug) |
| **Shader compilation check** | `packages/app/scripts/check-shader.ts` |
| **PNG diff / comparison** | `packages/app/scripts/diff-png.ts` |
| **Shared pack types + validation** | `packages/shared/src/` |
| **AT Protocol lexicons** | `lexicons/`, `packages/lexicons/src/generated/` |
| **CLI tool** | `packages/cli/src/` |
| **Registry server** | `packages/server/` |
| **Roadmap** | `FUTURE.md` |

## Conventions

- All RPC types (bun <-> webview) are defined in `packages/app/src/shared/rpc-types.ts`. Both sides import from there.
- Preferences are stored in SQLite (`bun:sqlite`) as JSON values in a `preferences(key, value)` table.
- The audiocap binary writes framed PCM to stdout and NDJSON status events to stderr. See ARCHITECTURE.md for wire format.
- Pack manifests are validated in `packages/shared/src/manifest.ts` (shared) and re-exported from `packages/app/src/bun/packs/loader.ts`. Tier 1 = shader only, Tier 2 = shader + WASM.
- Pack shaders can be `.wgsl` (native) or `.glsl` (Shadertoy convention). GLSL packs are transpiled to WGSL at load/import time via `glsl-preprocess.ts` → `naga` CLI → post-processing. GLSL is recommended for LLM-authored packs due to vastly more training data.
- The `naga` CLI binary is resolved via `findNagaBinary()` in `packages/app/src/bun/paths.ts` (checks bundle Resources, `~/.cargo/bin/naga`, then PATH).
- GPU work uses `bun:ffi` against wgpu-native symbols. Descriptor structs passed by pointer need keepalive arrays to survive GC.

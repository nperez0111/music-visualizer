# Agent Instructions

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the full system design. Keep both files up to date when making changes.

## Build commands

| Command | What |
|---------|------|
| `bun run dev` | Dev mode (Electrobun bundles + opens windows) |
| `bun run build:audiocap` | Build Rust audio helper -> `src/native/audiocap/audiocap`. **`cargo build` alone is not enough** — the app resolves the binary at `src/native/audiocap/audiocap`, not `target/release/`. |
| `bun run build:packs` | Compile AssemblyScript WASM packs |
| `bun test` | Run tests |
| `bunx tsc --noEmit` | Type-check (pre-existing errors in GPU FFI + AssemblyScript files are expected; filter for your changed files) |

## Where to find things

| Area | Key files |
|------|-----------|
| **App entry + RPC wiring** | `src/bun/index.ts` |
| **RPC type contracts** | `src/shared/rpc-types.ts` |
| **Audio capture (Rust)** | `src/native/audiocap/src/main.rs` |
| **Audio capture (TS)** | `src/bun/audio/capture.ts` |
| **Audio analysis (FFT, beats)** | `src/bun/audio/analysis.ts` |
| **Ring buffer** | `src/bun/audio/ring-buffer.ts` |
| **GPU renderer** | `src/bun/gpu/renderer.ts` |
| **Pack pipeline** | `src/bun/gpu/pipeline.ts` |
| **Transition compositing** | `src/bun/gpu/transition.ts` |
| **Pack loader + manifest** | `src/bun/packs/loader.ts` |
| **WASM pack runtime** | `src/bun/packs/runtime.ts` |
| **.viz import** | `src/bun/packs/import.ts` |
| **DB / preferences** | `src/bun/db/index.ts` |
| **Path resolution** | `src/bun/paths.ts` |
| **Controls UI** | `src/mainview/index.html`, `index.css`, `index.ts` |
| **Built-in packs** | `src/packs/<name>/manifest.json` + `shader.wgsl` |
| **Build scripts** | `scripts/build-audiocap.ts`, `scripts/build-packs.ts` |
| **Roadmap** | `FUTURE.md` |

## Conventions

- All RPC types (bun <-> webview) are defined in `src/shared/rpc-types.ts`. Both sides import from there.
- Preferences are stored in SQLite (`bun:sqlite`) as JSON values in a `preferences(key, value)` table.
- The audiocap binary writes framed PCM to stdout and NDJSON status events to stderr. See ARCHITECTURE.md for wire format.
- Pack manifests are validated in `src/bun/packs/loader.ts`. Tier 1 = shader only, Tier 2 = shader + WASM.
- GPU work uses `bun:ffi` against wgpu-native symbols. Descriptor structs passed by pointer need keepalive arrays to survive GC.

# @catnip/shared

Shared types, validation, hashing, and safety limits for the Cat Nip music visualizer monorepo. This package is the single source of truth for pack manifest definitions and is consumed by the desktop app (`packages/app`), the CLI tool (`packages/cli`), and the registry server (`packages/server`).

The package is pure TypeScript with no build step -- consumers import directly from the `.ts` source files via Bun's module resolution.

## Exports

The package exposes four entry points configured in `package.json` `"exports"`:

| Import path | Module | What it provides |
|---|---|---|
| `@catnip/shared` | `src/index.ts` | Barrel re-export of all public types and functions |
| `@catnip/shared/manifest` | `src/manifest.ts` | `validateManifest()` -- manifest validation |
| `@catnip/shared/hash` | `src/hash.ts` | `computePackHash()`, `computePackHashFromDir()`, `isPackHash()` |
| `@catnip/shared/limits` | `src/limits.ts` | `PACK_LIMITS` constant object |
| `@catnip/shared/types` | `src/types.ts` | All type definitions (no runtime code) |

## Types (`src/types.ts`)

Defines the core data structures shared across all packages:

- **`PackManifest`** -- The full manifest schema for a visualizer pack (schema version, name, version, shader path, optional WASM, audio features, parameters, images, presets, tags, multi-pass chains).
- **`PackParameter`** -- Discriminated union covering all parameter types: `float`, `int`, `bool`, `enum`, `color`, `range`, `vec2`, `vec3`, `vec4`.
- **`ParamValue`** / **`ParamValueMap`** -- Runtime parameter value types.
- **`PackPreset`** -- Named parameter preset (name + values map).
- **`PackManifestImage`** -- Image asset reference (name + file path).
- **`PackAudioFeatureName`** -- Union of recognized audio feature names (`rms`, `peak`, `bass`, `mid`, `treble`, `bpm`, `beat_phase`).

## Manifest validation (`src/manifest.ts`)

`validateManifest(raw: unknown)` takes an untyped JSON value and returns a discriminated result:

```ts
{ ok: true; m: PackManifest }   // valid -- sanitized manifest
{ ok: false; err: string }      // invalid -- human-readable error
```

Validation rules:

- `schemaVersion` must be exactly `1`.
- `name` and `version` are required non-empty strings.
- `shader` must end in `.wgsl` or `.glsl`.
- `wasm` (optional) must end in `.wasm`.
- `author` and `description` (optional) must be strings.
- **Parameters**: each entry is validated per type (correct fields, finite numbers, `min <= max`, enum default in options, correct array lengths for vector types). Names must match `/^[a-z][a-z0-9_]{0,31}$/i`. Duplicate names are rejected.
- **Audio features**: must be from the known set; duplicates are deduplicated.
- **Images**: must have unique names; file paths are checked for path traversal (`..`, `\`, null bytes, absolute paths).
- **Tags**: must be an array of strings.
- **Passes**: each entry must have a `shader` field ending in `.wgsl` or `.glsl`.
- **Presets**: must have unique names; values are filtered to only include keys that match declared parameter names.

The function produces a clean, normalized `PackManifest` -- unknown fields are stripped and only validated data is included in the output.

## Hashing (`src/hash.ts`)

Content-addressed SHA-256 hashing for pack identity and integrity:

- **`computePackHash(entries, prefix?)`** -- Computes a deterministic hash from an in-memory map of `{ relativePath: Uint8Array }`. Files are sorted by path; each file contributes `sha256(path):sha256(content)` to an outer SHA-256 digest. `manifest.json` and directory entries (trailing `/`) are automatically excluded.
- **`computePackHashFromDir(dir)`** -- Filesystem variant that walks a directory tree recursively and produces the same hash as the in-memory version for identical content.
- **`isPackHash(s)`** -- Returns `true` if the string is a valid 64-character lowercase hex SHA-256 hash.

The hash is used as a pack's content-addressed identifier across import, publishing, and registry operations.

## Limits (`src/limits.ts`)

`PACK_LIMITS` is a frozen constant object defining safety caps enforced across the entire system (import, loader, runtime, CLI, server):

| Constant | Value | Purpose |
|---|---|---|
| `MAX_ARCHIVE_BYTES` | 16 MiB | Maximum compressed `.viz` archive size |
| `MAX_TOTAL_UNCOMPRESSED_BYTES` | 64 MiB | Maximum total decompressed size of all archive entries |
| `MAX_ENTRY_BYTES` | 16 MiB | Maximum decompressed size of any single entry |
| `MAX_ENTRY_COUNT` | 64 | Maximum number of entries in a `.viz` archive |
| `MAX_WASM_MEMORY_PAGES` | 1024 (64 MiB) | Hard cap on WASM pack linear memory |
| `MAX_PACK_UNIFORM_BYTES` | 16,208 | Maximum bytes for pack-defined uniforms (16384 buffer - 176 host header) |
| `WASM_FRAME_DEADLINE_FRAMES` | 2 | Frames tolerated without a `viz_frame` response before termination |

## Architecture

```
packages/
  shared/         <-- this package: types + validation + hashing + limits
  app/            imports @catnip/shared (manifest validation, types, limits, hashing)
  cli/            imports @catnip/shared (validate, build, publish, info commands)
  server/         imports @catnip/shared (manifest validation for preview/indexing)
```

All three consumer packages declare `"@catnip/shared": "workspace:*"` in their `package.json` dependencies and import via the subpath exports. This ensures a single definition of the manifest schema, consistent validation logic, and uniform safety limits across the desktop app, CLI, and server.

The package has no runtime dependencies beyond Node/Bun built-ins (`crypto` for hashing, `fs`/`path` for the directory hash variant). It is designed to be portable -- the core validation and types have no filesystem or platform-specific dependencies.

## Key files

| File | Description |
|---|---|
| `src/types.ts` | All shared type definitions |
| `src/manifest.ts` | `validateManifest()` implementation |
| `src/hash.ts` | Pack hashing functions |
| `src/limits.ts` | `PACK_LIMITS` safety constants |
| `src/index.ts` | Barrel re-export |
| `src/manifest.test.ts` | Manifest validation tests |
| `src/hash.test.ts` | Hashing tests |
| `package.json` | Package config with subpath exports |
| `tsconfig.json` | TypeScript config (strict, noEmit) |

## Building

This package has no build step. It ships raw `.ts` source files (configured via `"files": ["src"]` in `package.json`) and consumers import them directly through Bun's TypeScript resolution.

To type-check:

```sh
bunx tsc --noEmit -p packages/shared/tsconfig.json
```

## Testing

Tests use `bun:test` and can be run from the repo root:

```sh
# Run all tests in the monorepo (includes shared)
bun test

# Run only shared package tests
bun test packages/shared/
```

The test suite covers:

- **Manifest validation** (`manifest.test.ts`): minimal valid manifests, all optional fields, all parameter types, rejection of invalid inputs, edge cases for audio features, images (path traversal), tags, passes, and presets (deduplication, unknown key stripping).
- **Hashing** (`hash.test.ts`): deterministic output, manifest.json exclusion, content/filename sensitivity, prefix filtering, directory entry skipping, filesystem-to-memory hash equivalence, and `isPackHash` format validation.

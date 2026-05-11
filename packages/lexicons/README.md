# @catnip/lexicons

AT Protocol lexicon schemas and generated TypeScript types for the Cat Nip pack registry.

## Overview

Cat Nip uses the [AT Protocol](https://atproto.com/) (the protocol behind Bluesky) as the backbone for its pack registry. Authors publish visualizer packs to their own Personal Data Server (PDS), and the Cat Nip registry server indexes them via a Jetstream firehose subscription.

This package defines the lexicon schemas that describe the three record types stored in user repositories, and exports generated TypeScript types and runtime validation schemas derived from those lexicons. It is consumed by both the registry server (`packages/server`) and the CLI tool (`packages/cli`).

## Lexicon schemas

The raw lexicon JSON files live in the top-level `lexicons/` directory (not inside this package). Three record types are defined under the `com.nickthesick.catnip.*` namespace:

### `com.nickthesick.catnip.release` (`lexicons/release.json`)

Identity record for a pack project. One record per project per author. The record key (`rkey`) is the pack's URL-safe slug.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string (1-256 chars) | yes | Human-readable pack name |
| `slug` | string (1-128 chars) | yes | URL-safe pack slug, used as the rkey |
| `description` | string (max 2048 chars) | no | Short description |
| `tags` | string[] (max 10 items, 64 chars each) | no | Categorization tags |
| `createdAt` | datetime | yes | ISO 8601 timestamp |

### `com.nickthesick.catnip.pack` (`lexicons/pack.json`)

Immutable version record. Each publish creates a new pack record referencing its parent release and carrying the `.viz` blob.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `release` | at-uri | yes | AT-URI of the parent `release` record |
| `version` | string (1-64 chars) | yes | Semver version string |
| `viz` | blob (application/zip, max 16 MB) | yes | The `.viz` archive (ZIP containing the pack) |
| `changelog` | string (max 4096 chars) | no | What changed in this version |
| `createdAt` | datetime | yes | ISO 8601 timestamp |

### `com.nickthesick.catnip.star` (`lexicons/star.json`)

A user stars a release. Uses TID-based record keys with server-side deduplication.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `subject` | at-uri | yes | AT-URI of the `release` record being starred |
| `createdAt` | datetime | yes | ISO 8601 timestamp |

## Code generation

TypeScript types and runtime validation schemas are generated from the lexicon JSON files using [`@atcute/lex-cli`](https://github.com/mary-ext/atcute).

### Configuration

The codegen configuration is defined in `lex.config.ts` at the repository root:

```ts
import { defineLexiconConfig } from "@atcute/lex-cli";

export default defineLexiconConfig({
  files: ["lexicons/**/*.json"],
  outdir: "packages/lexicons/src/generated",
  imports: ["@atcute/atproto"],
});
```

- **`files`** -- glob for the raw lexicon JSON schemas in `lexicons/`.
- **`outdir`** -- generated TypeScript is written to `packages/lexicons/src/generated/`.
- **`imports`** -- `@atcute/atproto` is imported so that standard AT Protocol types (e.g., `at-uri`, `datetime`, `blob`) are available.

### Running codegen

From the repository root:

```sh
bun run lexgen
```

This invokes `lex-cli generate`, which reads the config and writes generated files into `src/generated/`.

### What gets generated

Each lexicon produces a TypeScript module in `src/generated/types/com/nickthesick/catnip/` containing:

- A runtime `mainSchema` validation object (using `@atcute/lexicons/validations`) that can validate records at runtime.
- A `Main` TypeScript interface inferred from the schema for compile-time type safety.
- An ambient module declaration that registers the record type with `@atcute/lexicons/ambient`, enabling typed record lookups across the AT Protocol client stack.

A barrel `src/generated/index.ts` re-exports all three modules as namespaced exports (`ComNickthesickCatnipPack`, `ComNickthesickCatnipRelease`, `ComNickthesickCatnipStar`).

## Architecture

```
lexicons/                          Raw JSON schemas (source of truth)
  ├── release.json
  ├── pack.json
  └── star.json

lex.config.ts                      Codegen configuration

packages/lexicons/                 This package
  └── src/
      ├── index.ts                 Re-exports generated barrel
      └── generated/               Output of lex-cli generate
          ├── index.ts             Barrel (namespace exports)
          └── types/com/nickthesick/catnip/
              ├── pack.ts          Pack record schema + types
              ├── release.ts       Release record schema + types
              └── star.ts          Star record schema + types
```

### How it fits into the system

The registry flow works as follows:

1. **CLI (`packages/cli`)** -- The `catnip publish` command creates `release` and `pack` records on the author's PDS, uploading the `.viz` blob. OAuth scopes are requested for all three collection types.
2. **Jetstream indexer (`packages/server`)** -- The registry server subscribes to the AT Protocol firehose (via `@atcute/jetstream`), filtering for the three `com.nickthesick.catnip.*` collections. On commit events, it indexes releases, packs, and stars into a local SQLite database.
3. **Registry API (`packages/server`)** -- Serves pack listings, resolution endpoints, and star counts to the website and desktop app. Stars are written back to the user's PDS via OAuth.

Both `packages/server` and `packages/cli` depend on `@catnip/lexicons` as a workspace dependency for type-safe record construction and the collection NSID strings.

## Key files

| Path | Description |
|------|-------------|
| `lexicons/*.json` | Raw AT Protocol lexicon schemas (repo root) |
| `lex.config.ts` | Codegen configuration (repo root) |
| `packages/lexicons/package.json` | Package manifest |
| `packages/lexicons/src/index.ts` | Entry point, re-exports generated code |
| `packages/lexicons/src/generated/` | Generated TypeScript (do not edit by hand) |

## Dependencies

| Package | Purpose |
|---------|---------|
| `@atcute/lexicons` | Runtime validation primitives and ambient type registry |
| `@atcute/atproto` (dev) | Standard AT Protocol type definitions used during codegen |
| `@atcute/lex-cli` (root dev) | Code generator that reads lexicon JSON and emits TypeScript |

## Exports

The package exposes two export paths:

- `@catnip/lexicons` -- barrel re-export of all generated namespaces.
- `@catnip/lexicons/types/*` -- direct access to individual generated type modules (e.g., `@catnip/lexicons/types/com/nickthesick/catnip/pack`).

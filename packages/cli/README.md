# @catnip/cli

Command-line tool for authoring, validating, building, and publishing Cat Nip visualizer packs. The CLI is invoked as `catnip` and runs on [Bun](https://bun.sh).

## Commands

| Command      | Description                                                  |
|--------------|--------------------------------------------------------------|
| `create`     | Scaffold a new pack with a manifest and starter shader       |
| `validate`   | Check a pack's manifest and verify referenced files exist    |
| `build`      | Zip a pack directory into a `.viz` archive                   |
| `info`       | Display pack metadata from a `.viz` archive or directory     |
| `preview`    | Headless render a pack to PNG or animated WebP               |
| `login`      | Authenticate via AT Protocol OAuth (loopback flow)           |
| `whoami`     | Show current identity and session status                     |
| `publish`    | Upload a `.viz` to the user's PDS as AT Protocol records     |

Run `catnip <command> --help` for command-specific usage.

### create

Scaffold a new pack directory with a `manifest.json` and a starter shader file.

```
catnip create <slug> [options]

Options:
  --lang, -l <lang>      Shader language: glsl (default) or wgsl
  --dir, -d <path>       Parent directory (default: cwd)
  --author, -a <name>    Author name
  --description <text>   Short description
```

The slug must be lowercase, start with a letter, and contain only `a-z`, `0-9`, and hyphens. It is converted to title case for the manifest `name` field (e.g. `neon-tunnel` becomes "Neon Tunnel").

GLSL packs use the Shadertoy `mainImage` convention and are the recommended format for LLM-authored packs.

### validate

Validate a pack's `manifest.json` against the shared schema and verify that all referenced files (shader, WASM, pass shaders, images) exist on disk.

```
catnip validate [path]

  path    Pack directory (default: cwd)
```

### build

Package a pack directory into a `.viz` archive (a zip file). Validates the manifest, checks file size limits (defined in `@catnip/shared/limits`), computes a content hash, and writes the archive.

```
catnip build [path] [--out <file>]

  path         Pack directory (default: cwd)
  --out, -o    Output .viz path (default: <directory-name>.viz)
```

### info

Display metadata for a pack. Accepts either a `.viz` archive or a pack directory. Shows name, version, author, description, content hash, shader language, parameters, presets, passes, images, audio features, and tags.

```
catnip info <path>

  path    A .viz file or pack directory (default: cwd)
```

### preview

Render a pack headlessly to a PNG screenshot or animated WebP. Delegates to the repo's `scripts/render-pack-debug.ts` script, which requires wgpu-native (available after running `bun run dev`).

```
catnip preview <pack-dir-or-slug> [options]

Options:
  --out, -o <path>          Output path (default: /tmp/<slug>.png)
  --width <n>               Image width (default: 640)
  --height <n>              Image height (default: 480)
  --frames <n>              Frames to simulate (default: 120)
  --time <seconds>          Capture at a specific simulated time
  --webp                    Output animated WebP instead of PNG
  --webp-frames <n>         Frames for WebP animation (default: 20)
  --webp-duration <ms>      Duration per WebP frame (default: 100)
  --webp-quality <n>        WebP quality 0-100 (default: 80)
  --param <name>=<val>      Override a parameter (repeatable)
  --preset <name>           Apply a named preset
  --audio <key>=<val>       Override audio features (repeatable)
```

### login

Authenticate with the AT Protocol via OAuth. Uses `@atcute/oauth-node-client` in loopback mode (public client). The flow starts a temporary local HTTP server, opens the browser to the user's PDS authorization page, and exchanges the callback code for tokens.

```
catnip login <handle>

  handle    AT Protocol handle (e.g. alice.bsky.social)
```

Session data is persisted to `~/.config/catnip/`:
- `session.json` -- identity (DID, handle, PDS service URL)
- `oauth-sessions/` -- OAuth token state (managed by `@atcute/oauth-node-client`)
- `oauth-states/` -- temporary authorization state (10-minute TTL)

### whoami

Display the currently authenticated identity and verify the session is still valid.

```
catnip whoami [--logout]

  --logout    Clear the stored session and OAuth tokens
```

### publish

Build a `.viz` archive in memory, upload it as a blob to the user's PDS, then create (or update) AT Protocol records for the release and version.

```
catnip publish [path] [options]

  path                 Pack directory (default: cwd)
  --slug, -s <slug>    Release slug / record key (default: directory name)
  --changelog, -c      Changelog for this version
```

Requires `catnip login` first. Creates two records:
- `com.nickthesick.catnip.release` (rkey = slug) -- release metadata
- `com.nickthesick.catnip.pack` (rkey = slug:version) -- version record with the `.viz` blob

## Architecture

```
packages/cli/
  src/
    main.ts              Entry point, command router
    commands/
      create.ts          Scaffold a new pack
      validate.ts        Manifest + file validation
      build.ts           .viz archive creation
      info.ts            Pack metadata display
      preview.ts         Headless render (delegates to render-pack-debug.ts)
      login.ts           AT Protocol OAuth login
      whoami.ts           Identity display / logout
      publish.ts         Publish to AT Protocol network
      *.test.ts          Tests (bun:test)
    lib/
      auth.ts            OAuth client, session persistence, XRPC client
      auth.test.ts       Auth tests
```

Commands are lazily imported via `main.ts` -- only the requested command's module is loaded. Each command exports a `run(args: string[])` function.

### Key design points

- **Shared validation**: Manifest validation (`validateManifest`), content hashing (`computePackHash`), and archive size limits (`PACK_LIMITS`) come from `@catnip/shared`, ensuring consistency between the CLI, desktop app, and server.
- **AT Protocol native**: Publishing uses standard atproto record operations (`putRecord`, `uploadBlob`) via the user's own PDS -- no centralized server required for publishing.
- **OAuth loopback flow**: Authentication is direct between the CLI and the user's PDS. No registry server involvement. Tokens are stored locally and automatically refreshed.
- **Content-addressed archives**: Each `.viz` is content-hashed before upload, ensuring integrity and deduplication.

## Key files

| File | Purpose |
|------|---------|
| `src/main.ts` | CLI entry point, command dispatch |
| `src/commands/build.ts` | `.viz` archive builder |
| `src/commands/create.ts` | Pack scaffolding (GLSL/WGSL templates) |
| `src/commands/validate.ts` | Manifest + file existence checks |
| `src/commands/info.ts` | Metadata display (directory or archive) |
| `src/commands/preview.ts` | Headless render proxy |
| `src/commands/publish.ts` | AT Protocol publish flow |
| `src/commands/login.ts` | OAuth loopback login |
| `src/commands/whoami.ts` | Identity display / logout |
| `src/lib/auth.ts` | OAuth client setup, session storage, authenticated XRPC client |

## Building and running

The CLI is a Bun script (shebang `#!/usr/bin/env bun`), so no compile step is needed.

```sh
# From the repo root -- install all workspace dependencies
bun install

# Run the CLI directly
bun packages/cli/src/main.ts <command> [options]

# Or link it as a global command
cd packages/cli && bun link
catnip <command> [options]
```

### Running tests

```sh
# All tests across the monorepo
bun test

# CLI tests only
bun test packages/cli/
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@catnip/shared` | Manifest types, validation, content hashing, archive size limits |
| `@catnip/lexicons` | AT Protocol lexicon type definitions |
| `@atcute/client` | AT Protocol XRPC client |
| `@atcute/atproto` | AT Protocol type augmentations |
| `@atcute/oauth-node-client` | OAuth loopback client for CLI authentication |
| `@atcute/identity-resolver` | DID and handle resolution |
| `fflate` | Zip/unzip for `.viz` archive creation and reading |

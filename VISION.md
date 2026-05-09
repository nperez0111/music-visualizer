# Cat Nip Pack Registry

A decentralized pack registry built on AT Protocol. Authors publish visualizer
packs to the ATProto network from the CLI, a server indexes them and renders
animated previews, and a website lets anyone browse, search, and one-click
install packs into the desktop app.

```
 Author                  AT Protocol              Server                 User
 ------                  -----------              ------                 ----
 catnip publish -----> PDS (pack record + .viz blob)
                              |
                              v
                        Jetstream firehose
                              |
                              v
                       Nitro indexer -----> SQLite
                       render preview      (releases, versions, stars)
                              |
                              v
                        Website (SSR gallery)
                              |
                              v
                        catnip://install/did/rkey ---> Desktop app imports .viz
```

## AT Protocol Libraries

[atcute](https://github.com/mary-ext/atcute) provides the ATProto primitives
across all three packages:

| Package | Used by | Purpose |
|---------|---------|---------|
| `@atcute/client` | CLI, server | XRPC HTTP client (repo ops, blob upload) |
| `@atcute/jetstream` | server | Jetstream WebSocket client for indexing |
| `@atcute/oauth-node-client` | CLI | Direct loopback OAuth login flow |
| `@atcute/lex-cli` | build | Generate TypeScript from our lexicon schemas |
| `@atcute/tid` | server | TID codec for star rkeys |
| `@atcute/atproto` | CLI, server | `com.atproto.*` type definitions |
| `@atcute/lexicons` | shared | Schema validation |

Our lexicon schemas live at `packages/lexicons/` and compile to TypeScript via
`@atcute/lex-cli`. All packages import the generated types.

## AT Protocol Data Model

Namespace: `com.nickthesick.catnip.*`

### `com.nickthesick.catnip.release`

Identity record for a pack project. One per project per author. The rkey is
the pack slug (e.g. `neon-cruise`).

```json
{
  "$type": "com.nickthesick.catnip.release",
  "name": "Neon Cruise",
  "slug": "neon-cruise",
  "description": "Retro highway with audio-reactive neon lights",
  "tags": ["glsl", "driving", "neon"],
  "createdAt": "2025-05-01T00:00:00Z"
}
```

Tags are optional, max 10 items, each max 64 characters. They live on the
release record so the author controls categorization and they flow through
the firehose without needing to unzip the `.viz`.

### `com.nickthesick.catnip.pack`

Immutable version record. Each publish creates a new record referencing its
parent release and carrying the `.viz` blob. The rkey is `<slug>:<version>`
(e.g. `neon-cruise:1.2.0`), making AT URIs human-readable and constructible.

```json
{
  "$type": "com.nickthesick.catnip.pack",
  "release": "at://did:plc:abc123/com.nickthesick.catnip.release/neon-cruise",
  "version": "1.2.0",
  "viz": { "$type": "blob", "ref": { "$link": "bafkrei..." }, "mimeType": "application/zip", "size": 48210 },
  "changelog": "Added bloom pass, new color preset",
  "createdAt": "2025-05-04T12:00:00Z"
}
```

### `com.nickthesick.catnip.star`

A user stars a release. TID-based rkey, server-side dedup.

```json
{
  "$type": "com.nickthesick.catnip.star",
  "subject": "at://did:plc:abc123/com.nickthesick.catnip.release/neon-cruise",
  "createdAt": "2025-05-04T13:00:00Z"
}
```

### Version Immutability & Deletion

Pack records are immutable: once published at a given `slug:version`, the
record cannot be modified. If two records share the same `(slug, version)`,
the earliest `createdAt` wins; later duplicates are ignored by the indexer.

Release records may be updated to change `name`, `description`, or `tags`.
The `slug` field is immutable (it is the rkey).

Deleted records are tombstoned in the index: they are excluded from
latest-version selection and the gallery, but do not trigger uninstall on
desktops that already have the pack. The latest version is the highest semver
among non-deleted records for a given release.

## Server

Nitro v3 on the Bun preset. File-based routing. SQLite via `bun:sqlite`.

### Jetstream Indexer

`@atcute/jetstream` connects to Jetstream filtered on our three collections:

```
wss://jetstream2.us-east.bsky.network/subscribe
  ?wantedCollections=com.nickthesick.catnip.release
  &wantedCollections=com.nickthesick.catnip.pack
  &wantedCollections=com.nickthesick.catnip.star
```

Cursor-based reconnection ensures delivery across restarts. When a new pack
version arrives, the indexer:

1. Downloads the `.viz` blob from the author's PDS
2. Validates the manifest (shared validation from `packages/shared/`)
3. Renders an animated WebP preview via wgpu-native headless
4. Stores metadata + preview path in SQLite

Every version gets its own rendered preview.

Ingestion defences:
- Per-DID rate limit: max 20 version records per hour per DID. Excess events
  are logged and dropped.
- Preview render concurrency: max 2 concurrent headless renders. Additional
  renders queue and process in order.

### SQLite Schema

```sql
releases (did, rkey, name, slug, description, created_at, indexed_at)
versions (did, rkey, release_rkey, version, viz_cid, changelog, preview_path, created_at, indexed_at)
stars    (did, rkey, subject_uri, created_at)
tags     (version_rowid, tag)
```

### API Routes

| Route | Description |
|-------|-------------|
| `GET /api/packs` | List packs (search, tag filter, sort, pagination) |
| `GET /api/packs/:did/:slug` | Pack detail (metadata, versions, star count) |
| `GET /api/packs/:did/:slug/download` | Download latest `.viz` (proxied from PDS) |
| `GET /api/packs/:did/:slug/:version/download` | Download specific version |
| `GET /api/packs/:did/:slug/preview.webp` | Animated preview (latest version) |
| `GET /api/packs/:did/:slug/:version/preview.webp` | Preview for specific version |
| `GET /api/resolve/:handle/:slug` | Resolve handle to DID, redirect to pack detail |

### Moderation

Admin-only manual moderation. Flagged packs are hidden from the index.

## Website

Server-rendered via Nitro JSX. Dark aesthetic matching the existing gallery:
`#000` background, `#ffd959` yellow accent, Space Mono font.

### Pages

**Gallery** (`/`) — Searchable grid of pack cards. Each card shows the animated
WebP preview, name, author, star count, and tags. Filter by tags, sort by
newest / most starred.

**Pack detail** (`/pack/:did/:slug`) — Animated preview, full description,
version history, parameter list, star count, and an install button that opens
`catnip://install/:did/:slug`.

### Deep Links

`catnip://install/<did>/<rkey>` — The desktop app registers this URL scheme.
Clicking it fetches the `.viz` from the registry server and imports it via the
existing `importVizFile()` pipeline.

## CLI

Lives at `packages/cli/`. Installed globally as `catnip`.

| Command | Description |
|---------|-------------|
| `catnip create` | Scaffold a new pack (name, shader language, tier) |
| `catnip validate` | Check manifest + compile shader |
| `catnip preview` | Headless render to PNG or animated WebP |
| `catnip build` | Zip pack directory into a `.viz` archive |
| `catnip publish` | Upload `.viz` to PDS via `@atcute/client`, create release + version records |
| `catnip login` | Direct AT Protocol OAuth via `@atcute/oauth-node-client` loopback flow |
| `catnip whoami` | Show current identity |
| `catnip info` | Display pack metadata from a `.viz` or directory |

The CLI ships with agent skill references for LLM-assisted authoring
(new-pack, shader-check, screenshot-debug).

## Desktop App Integration

The app registers the `catnip://` URL scheme. When a deep link arrives:

1. Parse the DID and rkey from the URL
2. Fetch the `.viz` archive from the registry server API
3. Import via `importVizFile()` (content-addressed, idempotent)
4. Switch to the newly installed pack

If the registry server is unreachable, the app falls back to the author's PDS
directly:

1. `com.atproto.repo.listRecords` on the `com.nickthesick.catnip.pack`
   collection, filtering by the release AT-URI to find the latest version
2. `com.atproto.sync.getBlob` to fetch the `.viz` blob by CID
3. Same `importVizFile()` pipeline from there

A new `installFromRegistry` RPC lets the webview trigger the same flow from a
future browse-in-app UI.

## Shared Code

`packages/shared/` extracts core pack logic from `packages/app/src/bun/packs/` so the
desktop app, CLI, and server all share a single source of truth:

- `PackManifest` type and `validateManifest()`
- `computePackHash()` (content-addressed SHA-256)
- `PACK_LIMITS` (archive size, entry count, WASM memory)
- `PackParameter`, `PackPreset`, and related types

## Monorepo Layout

```
packages/
  app/        desktop visualizer (Electrobun)
  shared/     manifest types, validation, hashing, limits
  lexicons/   AT Protocol lexicon schemas + generated TypeScript
  cli/        CLI tool (catnip)
  server/     Nitro server (website + API + indexer)
```

## Phased Rollout

**Phase 1 — Foundation**
Extract shared code into `packages/shared/`. Implement `.viz` export
(`catnip build`). Wire up the desktop app to import from `packages/shared/`.

**Phase 2 — Local Workflow**
Build the CLI: `create`, `validate`, `preview`, `build`. Authors can create
and test packs locally without any network dependency.

**Phase 3 — Server + Website**
Stand up the Nitro server with SQLite, gallery UI, and headless preview
rendering. Initially seeded with built-in packs. The website works before
AT Protocol integration — packs can be uploaded directly.

**Phase 4 — AT Protocol**
Define lexicons, implement `publish` and `login` CLI commands, connect the
Jetstream indexer. Packs flow from author PDS through the network to the
gallery automatically.

**Phase 5 — Desktop Deep Links**
Register `catnip://` URL scheme, implement `installFromRegistry` RPC,
one-click install from website to app.

## Security

- Content-addressed pack IDs (SHA-256) are the canonical identity
- `.viz` import enforces archive size limits, path traversal prevention, and
  manifest validation at every entry point (desktop, server, CLI)
- Blob downloads are proxied through the server CDN
- Rate limiting on publish-related endpoints
- Admin moderation for takedowns

## Success Criteria

1. An author can publish a pack from the CLI and have it appear in the gallery
   within 30 seconds, installable via deep link on a fresh desktop app
2. An external developer can publish from a third-party PDS (tested against
   Bluesky's hosted service and at least one alternative PDS) and have it
   indexed and installable
3. The desktop app can install a pack when the registry server is unavailable
   by falling back to the author's PDS directly
4. Default server and CDN sustain 100 installs/min for a popular pack without
   degraded latency

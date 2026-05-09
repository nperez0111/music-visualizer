# @catnip/server

The Cat Nip pack registry server. A [Nitro](https://nitro.build/) application that provides:

- A **website** for browsing and discovering visualizer packs
- A **JSON API** for querying packs, downloading `.viz` files, and starring releases
- An **AT Protocol firehose indexer** that watches the Bluesky Jetstream for Cat Nip records and builds a local index
- **OAuth integration** for authenticating users via AT Protocol (used by the CLI tool)

## Architecture

```
                        Bluesky Jetstream (WebSocket)
                                  |
                                  v
                    +------ Indexer Plugin ------+
                    | watches 3 collections:     |
                    |   catnip.release           |
                    |   catnip.pack (versions)   |
                    |   catnip.star              |
                    +-----------|----------------+
                                |
                                v
+-------------- Nitro Server ---------------+
|                                           |
|   SQLite (registry.db)                    |
|     releases / versions / stars / tags    |
|     cursor (Jetstream position)           |
|     oauth_sessions / oauth_states         |
|                                           |
|   Routes:                                 |
|     /              Website homepage       |
|     /pack/:did/:slug  Pack detail page    |
|     /api/*         JSON API               |
|     /cli/login     CLI OAuth entry        |
|     /oauth/*       OAuth callback         |
|                                           |
|   Preview Renderer                        |
|     downloads .viz blobs from PDS         |
|     renders animated WebP previews        |
|     via headless GPU renderer             |
+-------------------------------------------+
```

Data flows from AT Protocol PDSes through the Jetstream firehose into a local SQLite index. The server never stores pack files directly -- `.viz` blobs live on user PDSes and are fetched on demand for downloads and preview rendering.

## API Endpoints

### Public API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check. Returns `{ status: "ok" }` or 503 if the DB is unreachable. |
| GET | `/api/packs` | List packs. Supports `?search=`, `?tag=`, `?sort=newest\|stars`, `?limit=`, `?offset=`. |
| GET | `/api/packs/:did/:slug` | Get a single release with all versions, star count, and tags. |
| GET | `/api/packs/:did/:slug/download` | Download the latest `.viz` file. Rate-limited by IP (100/min). Proxies the blob from the user's PDS. |
| GET | `/api/packs/:did/:slug/preview.webp` | Serve the animated WebP preview image for the latest version. |
| GET | `/api/resolve/:handle/:slug` | Resolve a human-readable handle (e.g. `alice.bsky.social`) to a DID, then look up the release. |

### Authenticated API

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/star` | Star or unstar a release. Body: `{ subject: "at://...", action: "star"\|"unstar" }`. Requires Bearer token. Rate-limited (60/min per DID). |

### OAuth / CLI

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cli/login` | Initiates OAuth flow for the CLI. Params: `?handle=&redirect_uri=http://127.0.0.1:<port>/callback`. |
| GET | `/oauth/callback` | OAuth callback from the user's PDS. Redirects to CLI localhost or website. |
| GET | `/oauth-client-metadata.json` | OAuth client metadata (auto-discovery). |
| GET | `/jwks.json` | JSON Web Key Set for confidential client mode. |

### Website Pages

| Path | Description |
|------|-------------|
| `/` | Homepage. Renders a grid of all published packs with preview images and star counts. |
| `/pack/:did/:slug` | Pack detail page. Shows preview, description, tags, star count, version history, and an install link (`catnip://install/...`). |

## Indexer

The indexer runs as a Nitro plugin (`plugins/indexer.ts`) that starts automatically on server boot. It connects to the Bluesky Jetstream WebSocket firehose and watches for three AT Protocol collections:

| Collection | Purpose |
|------------|---------|
| `com.nickthesick.catnip.release` | Pack releases (name, slug, description, tags) |
| `com.nickthesick.catnip.pack` | Pack versions (version string, `.viz` blob CID, changelog) |
| `com.nickthesick.catnip.star` | Stars (user favoriting a release) |

For each event (create, update, delete), the indexer upserts or deletes the corresponding row in the local SQLite database. The Jetstream cursor is persisted so the server can resume from where it left off after restarts.

### Preview Rendering

When a new pack version is indexed, the indexer asynchronously:

1. Downloads the `.viz` blob from the publisher's PDS via `com.atproto.sync.getBlob`
2. Extracts the zip, validates the manifest
3. Spawns the headless GPU renderer (`render-pack-debug.ts`) to produce a 320x240 animated WebP (20 frames)
4. Stores the preview path in the `versions` table

Preview rendering is limited to 2 concurrent renders to bound resource usage. Excess renders are dropped (not queued).

### Rate Limiting

Per-DID rate limiting is applied at the indexer level (20 pack versions per hour per DID) to defend against spam. This is separate from the API-level rate limits.

The indexer can be disabled entirely by setting `CATNIP_DISABLE_INDEXER=1`.

## Database

SQLite via `bun:sqlite`, stored at `<CATNIP_DATA_DIR>/registry.db` (default: `.data/registry.db`). Uses WAL journal mode and foreign keys.

### Schema

| Table | Purpose | Primary Key |
|-------|---------|-------------|
| `releases` | Pack releases (name, slug, description, hidden flag) | `(did, rkey)` |
| `versions` | Immutable pack versions (version string, viz blob CID, changelog, preview path) | `(did, rkey)` |
| `stars` | User stars on releases | `(did, rkey)` |
| `tags` | Tags associated with versions | FK to `versions` |
| `cursor` | Jetstream cursor position (single row) | `id = 1` |
| `oauth_sessions` | Persisted OAuth sessions for acting on behalf of users | `key` |
| `oauth_states` | Temporary OAuth state with 10-min TTL | `key` |

## Key Files

| File | Purpose |
|------|---------|
| `nitro.config.ts` | Nitro configuration (bun preset) |
| `plugins/indexer.ts` | AT Protocol Jetstream firehose consumer |
| `lib/db.ts` | SQLite database setup, migrations, and query helpers |
| `lib/oauth.ts` | AT Protocol OAuth client, session sealing/unsealing |
| `lib/preview.ts` | Server-side `.viz` download + headless preview rendering |
| `lib/rate-limit.ts` | In-memory sliding-window rate limiter |
| `routes/index.ts` | Website homepage (SSR HTML) |
| `routes/pack/[did]/[slug].ts` | Pack detail page (SSR HTML with OpenGraph tags) |
| `routes/api/packs.ts` | Pack listing API with search, tag, and sort |
| `routes/api/packs/[did]/[slug].ts` | Single pack API (release + versions + stars + tags) |
| `routes/api/packs/[did]/[slug]/download.ts` | `.viz` file download proxy |
| `routes/api/packs/[did]/[slug]/preview.webp.ts` | Preview image serving |
| `routes/api/resolve/[handle]/[slug].ts` | Handle-to-DID resolution + pack lookup |
| `routes/api/star.ts` | Star/unstar API |
| `routes/api/health.ts` | Health check |
| `routes/cli/login.ts` | CLI OAuth login initiation |
| `routes/oauth/callback.ts` | OAuth callback handler |

## How to Run

### Development

From the monorepo root:

```sh
bun run dev:server
```

Or from this directory:

```sh
bun --bun nitro dev
```

The server starts on port 3000 by default.

### Build

```sh
# From this directory
bun run build
# or equivalently:
nitro build --preset bun
```

Output is written to `.output/`.

### Tests

```sh
# From the monorepo root
bun test

# Or run server tests specifically
bun test packages/server/
```

Test files: `lib/db.test.ts`, `lib/rate-limit.test.ts`.

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CATNIP_DATA_DIR` | No | `.data` | Directory for SQLite database and preview images |
| `CATNIP_PUBLIC_URL` | No | `http://127.0.0.1:<PORT>` | Public URL of the server (used for OAuth metadata) |
| `CATNIP_DISABLE_INDEXER` | No | - | Set to `1` to disable the Jetstream indexer |
| `PORT` | No | `3000` | Server listen port |
| `PRIVATE_KEY_JWK` | No | - | JWK private key JSON for confidential OAuth client mode. When absent, runs as a public loopback client. |
| `COOKIE_SECRET` | Yes (for auth) | - | Secret for HMAC-based session sealing |

## Dependencies

### Runtime

| Package | Purpose |
|---------|---------|
| `@catnip/shared` | Pack manifest types and validation |
| `@catnip/lexicons` | AT Protocol lexicon schemas |
| `@atcute/client` | AT Protocol XRPC client |
| `@atcute/jetstream` | Bluesky Jetstream WebSocket consumer |
| `@atcute/oauth-node-client` | AT Protocol OAuth (confidential + public client) |
| `@atcute/identity-resolver` | DID/handle resolution (PLC, Web, well-known) |
| `@atcute/atproto` | AT Protocol type definitions |
| `fflate` | Zip extraction for `.viz` blobs |

### Dev

| Package | Purpose |
|---------|---------|
| `nitro` | Server framework (file-based routing, plugins, SSR) |
| `nano-jsx` | JSX runtime (configured but pages currently use template strings) |
| `@types/bun` | Bun type definitions |

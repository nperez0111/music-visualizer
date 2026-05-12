---
name: publish-pack
description: Publish a visualizer pack to the Cat Nip registry via the AT Protocol. Use when the user wants to publish, release, upload, or share a pack to the public registry, or needs help with authentication (login/logout), validation, building .viz archives, or managing their published packs.
---

# Publish a pack to the Cat Nip registry

This skill guides the user through publishing a visualizer pack to the
decentralized Cat Nip registry via the `catnip` CLI. Packs are published as
AT Protocol records to the user's PDS and indexed by the registry server.

## Prerequisites

The `catnip` CLI must be available. It lives at `packages/cli/` and is the
`@catnip/cli` workspace package. Run it with:

```bash
bunx catnip <command>
# or from the repo root:
bun packages/cli/src/main.ts <command>
```

## Quick Reference

### Commands

| Command | Description |
|---------|-------------|
| `catnip login <handle>` | Authenticate with AT Protocol OAuth |
| `catnip whoami` | Show current identity and session status |
| `catnip whoami --logout` | Clear stored session |
| `catnip validate [path]` | Validate manifest and check referenced files |
| `catnip build [path]` | Build a `.viz` archive without publishing |
| `catnip publish [path]` | Validate, build, and publish to the registry |

### Publish Options

| Option | Description | Default |
|--------|-------------|---------|
| `path` | Pack directory | `.` (current directory) |
| `--slug, -s <slug>` | Release slug (used as AT Protocol rkey) | Directory basename |
| `--changelog, -c <text>` | Changelog for this version | (none) |

### Build Options

| Option | Description | Default |
|--------|-------------|---------|
| `path` | Pack directory | `.` (current directory) |
| `--out, -o <file>` | Output `.viz` file path | `<slug>.viz` |

## Step 1 -- Check authentication

Before publishing, the user must be logged in. Run:

```bash
catnip whoami
```

If not logged in, guide them through login:

```bash
catnip login <handle>
```

Where `<handle>` is their AT Protocol handle (e.g. `alice.bsky.social`).

**How login works:**
1. A temporary local HTTP server starts on a random port on `127.0.0.1`
2. The browser opens to the user's PDS authorization page
3. The user approves the OAuth scopes (blob upload, record create/update/delete for releases, packs, and stars)
4. The PDS redirects back to the local server with an auth code
5. Tokens are exchanged and stored in `~/.config/catnip/`
6. Session identity (`{did, handle, service}`) is saved to `~/.config/catnip/session.json`

**Important:** This is a direct P2P OAuth flow between the CLI and the user's PDS. The registry server is not involved in authentication.

**Session storage:**
- `~/.config/catnip/session.json` -- identity only (`{did, handle, service}`)
- `~/.config/catnip/oauth-sessions/` -- OAuth tokens (auto-refreshed on use)
- `~/.config/catnip/oauth-states/` -- ephemeral auth states (10-min TTL)

**Logout:** `catnip whoami --logout` clears all stored session data.

## Step 2 -- Validate the pack

Always validate before publishing:

```bash
catnip validate <pack-directory>
```

This checks:
- `manifest.json` exists and passes schema validation
- All referenced files exist (shader, WASM, pass shaders, images)
- Prints a summary: shader language, tier, param count, presets, passes, images, tags

### What makes a valid manifest

The pack directory must contain a `manifest.json` conforming to the `PackManifest` schema:

```json
{
  "schemaVersion": 1,
  "name": "My Pack",
  "version": "0.1.0",
  "author": "alice.bsky.social",
  "description": "A cool visualizer",
  "shader": "shader.glsl",
  "tags": ["glsl", "fractal", "audio-reactive"],
  "parameters": [...],
  "presets": [...]
}
```

Required fields: `schemaVersion` (must be `1`), `name`, `version` (semver), `shader`.

Optional fields: `author`, `description`, `wasm`, `audio`, `parameters`, `images`, `presets`, `tags`, `passes`.

**Tags:** Up to 10 string tags for discovery. These are written to the release record and indexed by the server.

**Version:** Must be valid semver. Each version is immutable once published -- you cannot overwrite a published version. Bump the version in `manifest.json` before re-publishing.

## Step 3 -- Build a .viz archive (optional, for local testing)

To create a `.viz` file without publishing (useful for testing or sharing directly):

```bash
catnip build <pack-directory>
catnip build <pack-directory> --out my-pack.viz
```

The `.viz` format is a zip archive containing all pack files at the root level (flat, no wrapping directory). GLSL packs can be distributed as `.viz` containing `.glsl` source -- the importer transpiles during import.

### Size Limits

| Limit | Value |
|-------|-------|
| Max files | 64 |
| Max file size | 16 MB per file |
| Max total uncompressed | 64 MB |
| Max compressed archive | 16 MB |

If any limit is exceeded, the build (and publish) will fail with a descriptive error.

## Step 4 -- Publish

```bash
catnip publish <pack-directory>
catnip publish <pack-directory> --slug my-pack --changelog "Initial release"
```

### What publish does

1. **Validates** the manifest (same checks as `catnip validate`)
2. **Collects** all files in the pack directory (skips symlinks)
3. **Enforces** size limits (see above)
4. **Computes** a SHA-256 content hash of all files (excluding `manifest.json`)
5. **Zips** everything into a `.viz` archive in memory
6. **Authenticates** with the PDS (auto-refreshes expired OAuth tokens)
7. **Uploads** the `.viz` blob via `com.atproto.repo.uploadBlob`
8. **Creates/updates the release record:**
   - Collection: `com.nickthesick.catnip.release`
   - rkey: the slug (defaults to directory basename)
   - Fields: `$type`, `name`, `slug`, `description`, `createdAt`, `tags`
   - This record is idempotent (can be updated on re-publish)
9. **Creates the version record:**
   - Collection: `com.nickthesick.catnip.pack`
   - rkey: `<slug>:<version>` (e.g. `neon-cruise:1.2.0`)
   - Fields: `$type`, `release` (AT-URI), `version`, `viz` (blob ref), `createdAt`, `changelog`
   - This record is **immutable** -- publishing the same version twice will fail
10. **Prints** the release and version AT-URIs

### After publishing

The registry server's Jetstream indexer automatically picks up the new records:
- Validates record shape
- Upserts into the SQLite index
- Renders a preview WebP asynchronously (headless wgpu)
- The pack appears on the registry website and API within seconds

## Step 5 -- Verify publication

After publishing, the user can verify their pack is live:

1. **Check the registry website** -- the pack should appear at the registry URL
2. **Check via API** -- `GET /api/packs/<did>/<slug>` returns the pack detail
3. **Install from registry** -- other users can install via `catnip://install/<did>/<slug>` deep link or download from the website

## Workflows

### First-time publish (new pack)

```bash
# 1. Log in (one-time, session persists)
catnip login alice.bsky.social

# 2. Validate
catnip validate ./my-pack

# 3. Publish
catnip publish ./my-pack --slug my-pack --changelog "Initial release"
```

### Update an existing pack

```bash
# 1. Bump version in manifest.json (e.g. 0.1.0 -> 0.2.0)
# 2. Make your shader/parameter changes
# 3. Validate
catnip validate ./my-pack

# 4. Re-publish (same slug, new version)
catnip publish ./my-pack --slug my-pack --changelog "Added bloom effect"
```

The release record is updated (same rkey), and a new immutable version record is created.

### Build without publishing

```bash
# Create a .viz for sharing directly (e.g. via file transfer, email)
catnip build ./my-pack --out my-pack.viz

# The .viz can be imported in Cat Nip via File > Import or drag-and-drop
```

### Publish a built-in pack from the repo

Built-in packs live at `packages/app/src/packs/<slug>/`. To publish one:

```bash
catnip publish packages/app/src/packs/neon-cruise --slug neon-cruise --changelog "v1.0.0"
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/cli/src/main.ts` | CLI entry point, command router |
| `packages/cli/src/commands/login.ts` | AT Protocol OAuth loopback login |
| `packages/cli/src/commands/whoami.ts` | Show/clear session |
| `packages/cli/src/commands/validate.ts` | Manifest validation |
| `packages/cli/src/commands/build.ts` | Build `.viz` archive |
| `packages/cli/src/commands/publish.ts` | Full publish flow |
| `packages/cli/src/lib/auth.ts` | Session management, OAuth client creation |
| `packages/shared/src/manifest.ts` | Manifest schema validation (`validateManifest`) |
| `packages/shared/src/hash.ts` | Content hash computation (`computePackHash`) |
| `packages/shared/src/limits.ts` | Size limit constants (`PACK_LIMITS`) |
| `packages/shared/src/types.ts` | `PackManifest` type definition |
| `packages/server/plugins/indexer.ts` | Jetstream indexer (server-side) |

## Troubleshooting

### "Not logged in"
Run `catnip login <handle>` first. The session persists across CLI invocations until tokens expire or you log out.

### "Session may be expired"
Run `catnip login <handle>` again. OAuth tokens auto-refresh on use, but if the refresh token itself expires, a fresh login is needed.

### "No manifest.json found"
Make sure you're pointing at the pack directory containing `manifest.json`, not a parent directory.

### "Invalid manifest: ..."
Check the error message for specifics. Common issues:
- Missing `schemaVersion: 1`
- Missing or invalid `version` (must be semver like `"0.1.0"`)
- Missing `shader` field
- `shader` value doesn't match a real file

### "Shader file not found" / "WASM file not found"
The file referenced in `manifest.json` doesn't exist in the pack directory. Check the `shader`, `wasm`, `passes`, and `images` fields.

### "Too many files" / "File too large" / "Total uncompressed size too large" / "Compressed archive too large"
The pack exceeds size limits. Reduce file count or sizes. See the Size Limits table above.

### Version already published
Version records are immutable. If you get an error about the rkey already existing, bump the `version` field in `manifest.json` and publish again. You cannot overwrite a published version.

### "Login timed out (5 minutes)"
The OAuth callback wasn't received within 5 minutes. Try `catnip login` again and complete the browser authorization promptly.

### OAuth errors in browser
If the browser shows "Login failed" with an error, the PDS rejected the authorization. Check that the handle is correct and try again.

## What NOT to do

- **Don't publish without validating first.** While `catnip publish` runs validation internally, running `catnip validate` first gives you a chance to catch issues before attempting the upload.
- **Don't try to overwrite a published version.** Bump the version number instead. Version immutability is by design.
- **Don't include secrets or sensitive files in the pack directory.** Everything in the directory is bundled into the `.viz` archive and uploaded publicly.
- **Don't use symlinks in the pack directory.** They are silently skipped for security reasons.
- **Don't publish packs with `manifest.json` containing an `id` field.** Pack identity is computed from the content hash, not stored in the manifest.

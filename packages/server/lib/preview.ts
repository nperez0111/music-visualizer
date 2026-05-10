/**
 * Server-side preview rendering. Downloads a .viz blob from PDS,
 * extracts to a temp directory, spawns the headless renderer with --stdout,
 * and stores the animated WebP preview via unstorage.
 */

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { Client, ok, simpleFetchHandler } from "@atcute/client";
import { getDb, setVersionPreview, setVersionTags } from "./db.ts";
import { resolvePdsEndpoint } from "./did.ts";
import { validateManifest } from "@catnip/shared/manifest";
import { PACK_LIMITS } from "@catnip/shared/limits";
import { unzipSync } from "fflate";
import { useStorage } from "nitro/storage";

const UNSAFE_PATH = /(^|[\\\/])\.\.([\\\/]|$)|\\|\0/;

function isUnsafePath(rel: string): boolean {
	if (!rel) return true;
	if (rel.startsWith("/")) return true;
	if (rel.includes("..")) return true;
	if (rel.includes("\\")) return true;
	if (rel.includes("\0")) return true;
	return UNSAFE_PATH.test(rel);
}

const DATA_DIR = process.env.CATNIP_DATA_DIR ?? ".data";

/**
 * Path to the headless render script. In Docker mode (VIZ_RENDER_SCRIPT env or
 * VIZ_DOCKER_MODE), the script is placed at a known location by the Dockerfile.
 * In dev mode, resolve relative to the monorepo.
 */
const RENDER_SCRIPT = process.env.VIZ_RENDER_SCRIPT
	?? resolve(import.meta.dir, "../../../scripts/render-pack-debug.ts");

/**
 * Render a preview for a newly indexed pack version.
 * Downloads the .viz blob, extracts it, runs the headless renderer,
 * and stores the preview via unstorage.
 */
export async function renderVersionPreview(opts: {
	did: string;
	rkey: string;
	vizCid: string;
}): Promise<void> {
	const { did, rkey, vizCid } = opts;
	const db = getDb();

	// Download .viz blob from PDS (resolve the actual PDS for this DID)
	let vizBytes: Uint8Array;
	try {
		const pdsUrl = await resolvePdsEndpoint(did);
		const client = new Client({
			handler: simpleFetchHandler({ service: pdsUrl }),
		});
		vizBytes = await ok(
			client.get("com.atproto.sync.getBlob", {
				params: {
					did: did as `did:${string}:${string}`,
					cid: vizCid,
				},
				as: "bytes",
			}),
		);
	} catch (err) {
		console.error(`[preview] failed to download blob ${vizCid} for ${did}/${rkey}:`, err);
		return;
	}

	// Enforce archive size limit before decompression
	if (vizBytes.byteLength > PACK_LIMITS.MAX_ARCHIVE_BYTES) {
		console.error(
			`[preview] archive too large for ${did}/${rkey}: ${vizBytes.byteLength} > ${PACK_LIMITS.MAX_ARCHIVE_BYTES}`,
		);
		return;
	}

	// Extract to temp dir
	const tmpDir = join(DATA_DIR, "tmp", `${did.replace(/:/g, "_")}_${rkey}`);
	mkdirSync(tmpDir, { recursive: true });

	try {
		const entries = unzipSync(vizBytes);

		// Enforce entry count and size limits
		const allKeys = Object.keys(entries);
		const fileKeys = allKeys.filter((k) => !k.endsWith("/"));
		if (fileKeys.length > PACK_LIMITS.MAX_ENTRY_COUNT) {
			console.error(
				`[preview] too many entries for ${did}/${rkey}: ${fileKeys.length} > ${PACK_LIMITS.MAX_ENTRY_COUNT}`,
			);
			return;
		}

		let totalUncompressed = 0;
		for (const k of fileKeys) {
			const sz = entries[k]!.byteLength;
			if (sz > PACK_LIMITS.MAX_ENTRY_BYTES) {
				console.error(
					`[preview] entry "${k}" too large for ${did}/${rkey}: ${sz} > ${PACK_LIMITS.MAX_ENTRY_BYTES}`,
				);
				return;
			}
			totalUncompressed += sz;
			if (totalUncompressed > PACK_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
				console.error(
					`[preview] total uncompressed size exceeds limit for ${did}/${rkey}`,
				);
				return;
			}
		}

		// Find manifest prefix (handle wrapper dirs)
		let prefix = "";
		for (const path of Object.keys(entries)) {
			if (path === "manifest.json" || path.endsWith("/manifest.json")) {
				prefix = path.replace("manifest.json", "");
				break;
			}
		}

		// Validate all paths before writing anything to disk
		for (const path of fileKeys) {
			if (prefix && !path.startsWith(prefix)) continue;
			const rel = path.slice(prefix.length);
			if (isUnsafePath(rel)) {
				console.error(
					`[preview] unsafe path in archive for ${did}/${rkey}: "${path}"`,
				);
				return;
			}
		}

		// Extract all files
		const packDir = join(tmpDir, "pack");
		mkdirSync(packDir, { recursive: true });

		for (const [path, data] of Object.entries(entries)) {
			if (path.endsWith("/")) continue;
			const rel = path.startsWith(prefix) ? path.slice(prefix.length) : path;
			if (!rel) continue;
			if (isUnsafePath(rel)) return; // Belt-and-suspenders
			const dest = join(packDir, rel);
			mkdirSync(join(dest, ".."), { recursive: true });
			writeFileSync(dest, data);
		}

		// Validate manifest and extract tags
		const manifestPath = join(packDir, "manifest.json");
		if (!existsSync(manifestPath)) {
			console.error(`[preview] no manifest.json found in blob for ${did}/${rkey}`);
			return;
		}

		const manifestRaw = JSON.parse(readFileSync(manifestPath, "utf8"));
		const validated = validateManifest(manifestRaw);
		if (!validated.ok) {
			console.error(`[preview] invalid manifest for ${did}/${rkey}: ${validated.err}`);
			return;
		}

		// Store tags
		if (validated.m.tags?.length) {
			setVersionTags(db, did, rkey, validated.m.tags);
		}

		// Render animated WebP preview via --stdout (binary on stdout, logs on stderr)
		const storageKey = `${did.replace(/:/g, "_")}_${rkey}.webp`;

		const result = spawnSync("bun", [
			RENDER_SCRIPT,
			packDir,
			"--webp",
			"--stdout",
			"--webp-frames", "20",
			"--webp-duration", "100",
			"--webp-quality", "75",
			"--width", "320",
			"--height", "240",
		], {
			cwd: process.env.VIZ_RENDER_CWD ?? resolve(import.meta.dir, "../../.."),
			stdio: "pipe",
			timeout: 30_000,
			env: {
				...process.env,
				// Propagate Docker mode to the render subprocess
				...(process.env.VIZ_DOCKER_MODE ? { VIZ_DOCKER_MODE: "1" } : {}),
			},
		});

		if (result.status !== 0) {
			const stderr = result.stderr?.toString() ?? "";
			console.error(`[preview] render failed for ${did}/${rkey}: ${stderr.slice(0, 500)}`);
			return;
		}

		const webpBuffer = result.stdout;
		if (!webpBuffer || webpBuffer.length === 0) {
			console.error(`[preview] render produced no output for ${did}/${rkey}`);
			return;
		}

		// Store preview via unstorage
		await useStorage("previews").setItemRaw(storageKey, webpBuffer);

		// Update DB with storage key
		setVersionPreview(db, did, rkey, storageKey);
		console.log(`[preview] rendered preview for ${did}/${rkey} -> previews:${storageKey}`);
	} finally {
		// Cleanup temp dir
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	}
}

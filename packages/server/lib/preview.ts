/**
 * Server-side preview rendering. Downloads a .viz blob from PDS,
 * extracts to a temp directory, spawns the headless renderer with --stdout,
 * and stores the animated WebP preview via unstorage.
 */

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { Client, simpleFetchHandler } from "@atcute/client";
import { getDb, setVersionPreview, setVersionTags } from "./db.ts";
import { validateManifest } from "@catnip/shared/manifest";
import { unzipSync } from "fflate";
import { useStorage } from "nitro/storage";

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

	// Download .viz blob from PDS
	let vizBytes: Uint8Array;
	try {
		const client = new Client({
			handler: simpleFetchHandler({ service: "https://bsky.social" }),
		});
		const response = await client.get("com.atproto.sync.getBlob", {
			params: { did, cid: vizCid },
		});
		vizBytes = new Uint8Array(response.data as ArrayBuffer);
	} catch (err) {
		console.error(`[preview] failed to download blob ${vizCid} for ${did}/${rkey}:`, err);
		return;
	}

	// Extract to temp dir
	const tmpDir = join(DATA_DIR, "tmp", `${did.replace(/:/g, "_")}_${rkey}`);
	mkdirSync(tmpDir, { recursive: true });

	try {
		const entries = unzipSync(vizBytes);

		// Find manifest prefix (handle wrapper dirs)
		let prefix = "";
		for (const path of Object.keys(entries)) {
			if (path === "manifest.json" || path.endsWith("/manifest.json")) {
				prefix = path.replace("manifest.json", "");
				break;
			}
		}

		// Extract all files
		const packDir = join(tmpDir, "pack");
		mkdirSync(packDir, { recursive: true });

		for (const [path, data] of Object.entries(entries)) {
			if (path.endsWith("/")) continue;
			const rel = path.startsWith(prefix) ? path.slice(prefix.length) : path;
			if (!rel) continue;
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

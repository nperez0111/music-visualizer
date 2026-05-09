/**
 * Server-side preview rendering. Downloads a .viz blob from PDS,
 * extracts to a temp directory, and spawns the headless renderer
 * to produce an animated WebP preview.
 */

import { spawnSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join, resolve } from "path";
import { Client, simpleFetchHandler } from "@atcute/client";
import { getDb, setVersionPreview, setVersionTags } from "./db.ts";
import { validateManifest } from "@catnip/shared/manifest";
import { unzipSync } from "fflate";

const DATA_DIR = process.env.CATNIP_DATA_DIR ?? ".data";
const PREVIEWS_DIR = join(DATA_DIR, "previews");
const RENDER_SCRIPT = resolve(import.meta.dir, "../../../scripts/render-pack-debug.ts");

/**
 * Render a preview for a newly indexed pack version.
 * Downloads the .viz blob, extracts it, runs the headless renderer,
 * and updates the DB with the preview path and tags.
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

		const manifestRaw = JSON.parse(require("fs").readFileSync(manifestPath, "utf8"));
		const validated = validateManifest(manifestRaw);
		if (!validated.ok) {
			console.error(`[preview] invalid manifest for ${did}/${rkey}: ${validated.err}`);
			return;
		}

		// Store tags
		if (validated.m.tags?.length) {
			setVersionTags(db, did, rkey, validated.m.tags);
		}

		// Render animated WebP preview
		mkdirSync(PREVIEWS_DIR, { recursive: true });
		const previewPath = join(PREVIEWS_DIR, `${did.replace(/:/g, "_")}_${rkey}.webp`);

		const result = spawnSync("bun", [
			RENDER_SCRIPT,
			packDir,
			"--webp",
			"--webp-frames", "20",
			"--webp-duration", "100",
			"--webp-quality", "75",
			"--width", "320",
			"--height", "240",
			"--out", previewPath,
		], {
			cwd: resolve(import.meta.dir, "../../.."),
			stdio: "pipe",
			timeout: 30_000,
		});

		if (result.status !== 0) {
			const stderr = result.stderr?.toString() ?? "";
			console.error(`[preview] render failed for ${did}/${rkey}: ${stderr.slice(0, 500)}`);
			return;
		}

		if (!existsSync(previewPath)) {
			console.error(`[preview] render produced no output for ${did}/${rkey}`);
			return;
		}

		// Update DB
		setVersionPreview(db, did, rkey, previewPath);
		console.log(`[preview] rendered preview for ${did}/${rkey} -> ${previewPath}`);
	} finally {
		// Cleanup temp dir
		try {
			rmSync(tmpDir, { recursive: true, force: true });
		} catch {}
	}
}

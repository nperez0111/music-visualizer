import { defineHandler } from "nitro";
import { getRouterParams, createError, setResponseHeader } from "nitro/h3";
import { getDb, type VersionRow } from "../../../../../lib/db.ts";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export default defineHandler(async (event) => {
	const db = getDb();
	const { did, slug } = getRouterParams(event);

	// Get latest version with a preview
	const version = db
		.prepare(
			`SELECT * FROM versions
			 WHERE release_did = ? AND release_rkey = ? AND preview_path IS NOT NULL
			 ORDER BY created_at DESC LIMIT 1`,
		)
		.get(did, slug) as VersionRow | null;

	if (!version?.preview_path) {
		throw createError({ statusCode: 404, statusMessage: "Preview not available" });
	}

	// Read directly from filesystem instead of going through unstorage.
	// unstorage's getItemRaw() returns different types depending on the runtime
	// (Buffer, ArrayBuffer, NodeResponse, etc.), and Nitro's Bun dev worker proxy
	// cannot reliably serialize these binary Response objects under concurrent load.
	// Reading the file directly and returning a plain Buffer avoids this entirely.
	const dataDir = process.env.DATA_DIR || ".data";
	// unstorage fs driver maps ":" in keys to "/" on disk
	const previewsRoot = resolve(join(dataDir, "previews"));
	const filePath = resolve(join(previewsRoot, version.preview_path.replaceAll(":", "/")));

	// Guard against path traversal from malformed preview_path values
	if (!filePath.startsWith(previewsRoot + "/") && filePath !== previewsRoot) {
		throw createError({ statusCode: 400, statusMessage: "Invalid preview path" });
	}

	let buf: Buffer;
	try {
		buf = readFileSync(filePath);
	} catch {
		throw createError({ statusCode: 404, statusMessage: "Preview not available" });
	}

	setResponseHeader(event, "Content-Type", "image/webp");
	setResponseHeader(event, "Cache-Control", "public, max-age=86400");
	return buf;
});

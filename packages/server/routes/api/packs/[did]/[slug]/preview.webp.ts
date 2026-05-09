import { defineHandler } from "nitro";
import { getRouterParams, createError, setHeader, sendStream } from "nitro/h3";
import { getDb, type VersionRow } from "../../../../../lib/db.ts";
import { existsSync, createReadStream } from "fs";

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

	if (!version?.preview_path || !existsSync(version.preview_path)) {
		throw createError({ statusCode: 404, statusMessage: "Preview not available" });
	}

	setHeader(event, "Content-Type", "image/webp");
	setHeader(event, "Cache-Control", "public, max-age=86400");
	return sendStream(event, createReadStream(version.preview_path));
});

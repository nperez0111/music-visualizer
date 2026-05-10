import { defineHandler } from "nitro";
import { useStorage } from "nitro/storage";
import { getRouterParams, createError, setHeader } from "nitro/h3";
import { getDb, type VersionRow } from "../../../../../lib/db.ts";

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

	// Read preview from unstorage (preview_path is now a storage key)
	const data = await useStorage("previews").getItemRaw(version.preview_path);
	if (!data) {
		throw createError({ statusCode: 404, statusMessage: "Preview not available" });
	}

	setHeader(event, "Content-Type", "image/webp");
	setHeader(event, "Cache-Control", "public, max-age=86400");
	return data;
});

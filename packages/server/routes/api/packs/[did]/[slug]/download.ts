import { defineHandler } from "nitro";
import { useStorage } from "nitro/storage";
import { getRouterParams, createError, setHeader, getRequestIP } from "nitro/h3";
import { getDb, type VersionRow } from "../../../../../lib/db.ts";
import { Client, simpleFetchHandler } from "@atcute/client";
import { downloadLimiter } from "../../../../../lib/rate-limit.ts";

export default defineHandler(async (event) => {
	// Rate limit by IP
	const ip = getRequestIP(event, { xForwardedFor: true }) ?? "unknown";
	if (!downloadLimiter.check(ip)) {
		throw createError({ statusCode: 429, statusMessage: "Rate limited. Try again later." });
	}

	const db = getDb();
	const { did, slug } = getRouterParams(event);

	// Get latest version
	const version = db
		.prepare(
			"SELECT * FROM versions WHERE release_did = ? AND release_rkey = ? ORDER BY created_at DESC LIMIT 1",
		)
		.get(did, slug) as VersionRow | null;

	if (!version) {
		throw createError({ statusCode: 404, statusMessage: "No versions found" });
	}

	// Check unstorage cache first
	const cacheKey = `${version.did}_${version.viz_cid}.viz`;
	const storage = useStorage("vizCache");
	let blob = await storage.getItemRaw(cacheKey);

	if (!blob) {
		// Cache miss — fetch from PDS and cache lazily
		const client = new Client({
			handler: simpleFetchHandler({ service: "https://bsky.social" }),
		});

		const response = await client.get("com.atproto.sync.getBlob", {
			params: { did: version.did, cid: version.viz_cid },
		});

		blob = Buffer.from(response.data as ArrayBuffer);

		// Fire-and-forget cache write
		storage.setItemRaw(cacheKey, blob).catch(() => {});
	}

	setHeader(event, "Content-Type", "application/zip");
	setHeader(event, "Content-Disposition", `attachment; filename="${slug}.viz"`);
	setHeader(event, "Cache-Control", "public, max-age=604800, immutable");
	return blob;
});

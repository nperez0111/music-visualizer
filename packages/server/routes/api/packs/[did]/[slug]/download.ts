import { defineHandler } from "nitro";
import { useStorage } from "nitro/storage";
import { getRouterParams, createError, setHeader, getRequestIP } from "nitro/h3";
import { getDb, type VersionRow } from "../../../../../lib/db.ts";
import { Client, simpleFetchHandler } from "@atcute/client";
import { resolvePdsEndpoint } from "../../../../../lib/did.ts";
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
		// Cache miss — resolve PDS and fetch blob
		const pdsUrl = await resolvePdsEndpoint(version.did);
		const client = new Client({
			handler: simpleFetchHandler({ service: pdsUrl }),
		});

		const response = await (client as any).get("com.atproto.sync.getBlob", {
			params: { did: version.did, cid: version.viz_cid },
			as: "bytes",
		});

		if (!response.ok) {
			throw createError({ statusCode: 502, statusMessage: "Failed to fetch blob from PDS" });
		}

		blob = Buffer.from(response.data as Uint8Array);

		// Fire-and-forget cache write
		storage.setItemRaw(cacheKey, blob).catch(() => {});
	}

	setHeader(event, "Content-Type", "application/zip");
	// Sanitize slug for Content-Disposition header (strip quotes, control chars, non-ASCII)
	const safeSlug = slug.replace(/["\r\n\x00-\x1f\x7f-\xff]/g, "").slice(0, 128) || "pack";
	setHeader(event, "Content-Disposition", `attachment; filename="${safeSlug}.viz"`);
	setHeader(event, "Cache-Control", "public, max-age=604800, immutable");
	return blob;
});

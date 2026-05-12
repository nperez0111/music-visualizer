import { defineHandler } from "nitro";
import { useStorage } from "nitro/storage";
import { getRouterParams, createError, getRequestIP } from "nitro/h3";
import { getDb, incrementInstalls, type VersionRow } from "../../../../../lib/db.ts";
import { Client, ClientResponseError, ok, simpleFetchHandler } from "@atcute/client";
import type {} from "@atcute/atproto";
import { resolvePdsEndpoint } from "../../../../../lib/did.ts";
import { downloadLimiter } from "../../../../../lib/rate-limit.ts";

/** Convert whatever getItemRaw() returns into a Uint8Array. */
async function toBytes(raw: unknown): Promise<Uint8Array | null> {
	if (!raw) return null;
	if (raw instanceof Uint8Array) return raw;
	if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
	if (typeof (raw as any).arrayBuffer === "function") {
		return new Uint8Array(await (raw as any).arrayBuffer());
	}
	return null;
}

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
	let blob = await toBytes(await storage.getItemRaw(cacheKey));

	if (!blob) {
		// Cache miss — resolve PDS and fetch blob
		const pdsUrl = await resolvePdsEndpoint(version.did);
		const client = new Client({
			handler: simpleFetchHandler({ service: pdsUrl }),
		});

		try {
			blob = await ok(
				client.get("com.atproto.sync.getBlob", {
					params: {
						did: version.did as `did:${string}:${string}`,
						cid: version.viz_cid,
					},
					as: "bytes",
				}),
			);
		} catch (err) {
			if (err instanceof ClientResponseError) {
				console.error(`[download] PDS returned ${err.status} for blob ${version.viz_cid} (${pdsUrl}): ${err.description}`);
			} else {
				console.error(`[download] failed to fetch blob from PDS (${pdsUrl}):`, err);
			}
			throw createError({ statusCode: 502, statusMessage: "Failed to fetch blob from PDS" });
		}

		// Fire-and-forget cache write
		storage.setItemRaw(cacheKey, Buffer.from(blob)).catch(() => {});
	}

	// Track install (fire-and-forget, don't block the response)
	try { incrementInstalls(db, did, slug); } catch {}

	// Sanitize slug for Content-Disposition header (strip quotes, control chars, non-ASCII)
	const safeSlug = slug.replace(/["\r\n\x00-\x1f\x7f-\xff]/g, "").slice(0, 128) || "pack";

	// Return a web-standard Response to avoid NodeResponse serialization
	// issues with Nitro's Bun dev worker proxy.
	return new Response(blob as BodyInit, {
		headers: {
			"Content-Type": "application/zip",
			"Content-Disposition": `attachment; filename="${safeSlug}.viz"`,
			"Cache-Control": "public, max-age=604800, immutable",
		},
	});
});

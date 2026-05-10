/**
 * GET /api/resolve/:handle/:slug
 *
 * Resolves an AT Protocol handle to a DID, then looks up the pack release
 * in the local index. Returns the canonical DID + release metadata, or 404.
 *
 * This lets clients use human-readable identifiers (e.g. alice.bsky.social/neon-cruise)
 * instead of raw DIDs.
 */

import { defineHandler } from "nitro";
import { getRouterParams, createError } from "nitro/h3";
import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import { getDb, type ReleaseRow, type VersionRow } from "../../../../lib/db.ts";

let _handleResolver: CompositeHandleResolver | null = null;

function getHandleResolver(): CompositeHandleResolver {
	if (!_handleResolver) {
		_handleResolver = new CompositeHandleResolver({
			resolvers: [new WellKnownHandleResolver()],
		});
	}
	return _handleResolver;
}

// Validates that a handle looks like a valid AT Protocol handle (domain-like, no IP addresses)
const HANDLE_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

export default defineHandler(async (event) => {
	const { handle, slug } = getRouterParams(event);

	if (!handle || !slug) {
		throw createError({ statusCode: 400, statusMessage: "Missing handle or slug" });
	}

	// Reject handles that don't look like valid domains to prevent SSRF
	if (!HANDLE_RE.test(handle) || handle.length > 253) {
		throw createError({ statusCode: 400, statusMessage: "Invalid handle format" });
	}

	// Resolve handle -> DID
	let did: string;
	try {
		did = await getHandleResolver().resolve(handle);
	} catch {
		throw createError({ statusCode: 404, statusMessage: `Could not resolve handle: ${handle}` });
	}

	// Look up the release in the index
	const db = getDb();
	const release = db
		.prepare("SELECT * FROM releases WHERE did = ? AND rkey = ? AND hidden = 0")
		.get(did, slug) as ReleaseRow | null;

	if (!release) {
		throw createError({ statusCode: 404, statusMessage: "Pack not found" });
	}

	// Get latest version
	const latestVersion = db
		.prepare(
			"SELECT * FROM versions WHERE release_did = ? AND release_rkey = ? ORDER BY created_at DESC LIMIT 1",
		)
		.get(did, slug) as VersionRow | null;

	// Get star count
	const starCount = db
		.prepare("SELECT COUNT(*) as count FROM stars WHERE subject_uri = ?")
		.get(`at://${did}/com.nickthesick.catnip.release/${slug}`) as { count: number };

	return {
		did,
		handle,
		release,
		latestVersion,
		stars: starCount.count,
	};
});

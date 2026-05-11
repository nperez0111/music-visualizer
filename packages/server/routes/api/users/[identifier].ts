/**
 * GET /api/users/:identifier
 *
 * Returns a user's profile info and their published packs.
 * The identifier can be a DID (did:plc:... or did:web:...) or an AT Protocol handle.
 *
 * Response:
 *   { did, handle, packs: [...], packCount, totalStars }
 */

import { defineHandler } from "nitro";
import { getRouterParams, createError } from "nitro/h3";
import {
	CompositeHandleResolver,
	DohJsonHandleResolver,
	WellKnownHandleResolver,
	CompositeDidDocumentResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	LocalActorResolver,
} from "@atcute/identity-resolver";
import { getDb, getPacksByDid } from "../../../lib/db.ts";

let _handleResolver: CompositeHandleResolver | null = null;
let _actorResolver: LocalActorResolver | null = null;

function getHandleResolver(): CompositeHandleResolver {
	if (!_handleResolver) {
		_handleResolver = new CompositeHandleResolver({
			methods: {
				http: new WellKnownHandleResolver(),
				dns: new DohJsonHandleResolver({
					dohUrl: "https://cloudflare-dns.com/dns-query",
				}),
			},
		});
	}
	return _handleResolver;
}

function getActorResolver(): LocalActorResolver {
	if (!_actorResolver) {
		_actorResolver = new LocalActorResolver({
			handleResolver: getHandleResolver(),
			didDocumentResolver: new CompositeDidDocumentResolver({
				methods: {
					plc: new PlcDidDocumentResolver(),
					web: new WebDidDocumentResolver(),
				},
			}),
		});
	}
	return _actorResolver;
}

const HANDLE_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function isDid(s: string): boolean {
	return s.startsWith("did:");
}

export default defineHandler(async (event) => {
	const { identifier } = getRouterParams(event);

	if (!identifier) {
		throw createError({ statusCode: 400, statusMessage: "Missing identifier" });
	}

	let did: string;
	let handle: string | null = null;

	if (isDid(identifier)) {
		did = identifier;
		// Try to resolve the handle from the DID for display purposes
		try {
			const actor = await getActorResolver().resolve(did as `did:plc:${string}`);
			handle = actor.handle;
		} catch {
			// handle resolution is best-effort
		}
	} else {
		// Treat as a handle
		if (!HANDLE_RE.test(identifier) || identifier.length > 253) {
			throw createError({ statusCode: 400, statusMessage: "Invalid handle format" });
		}
		handle = identifier;
		try {
			did = await getHandleResolver().resolve(identifier as `${string}.${string}`);
		} catch {
			throw createError({ statusCode: 404, statusMessage: `Could not resolve handle: ${identifier}` });
		}
	}

	const db = getDb();
	const packs = getPacksByDid(db, did);

	// If no packs and we couldn't resolve the handle, the user probably doesn't exist
	if (packs.length === 0 && !handle) {
		throw createError({ statusCode: 404, statusMessage: "User not found" });
	}

	const totalStars = packs.reduce((sum, p) => sum + p.star_count, 0);

	return {
		did,
		handle,
		packCount: packs.length,
		totalStars,
		packs,
	};
});

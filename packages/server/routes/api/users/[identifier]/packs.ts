/**
 * GET /api/users/:identifier/packs
 *
 * Returns the list of downloadable packs for a user, suitable for batch install.
 * The identifier can be a DID or an AT Protocol handle.
 *
 * Response:
 *   { did, packs: [{ did, slug, name, downloadUrl }] }
 *
 * The app can iterate over the packs array and call each downloadUrl to fetch
 * the .viz file via the existing download endpoint.
 */

import { defineHandler } from "nitro";
import { getRouterParams, createError } from "nitro/h3";
import {
	CompositeHandleResolver,
	DohJsonHandleResolver,
	WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import { getDb, getPacksByDid } from "../../../../lib/db.ts";

let _handleResolver: CompositeHandleResolver | null = null;

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

	if (isDid(identifier)) {
		did = identifier;
	} else {
		if (!HANDLE_RE.test(identifier) || identifier.length > 253) {
			throw createError({ statusCode: 400, statusMessage: "Invalid handle format" });
		}
		try {
			did = await getHandleResolver().resolve(identifier as `${string}.${string}`);
		} catch {
			throw createError({ statusCode: 404, statusMessage: `Could not resolve handle: ${identifier}` });
		}
	}

	const db = getDb();
	const allPacks = getPacksByDid(db, did);

	// Only include packs that have at least one version (i.e. a downloadable .viz)
	const downloadable = allPacks
		.filter((p) => p.latest_version !== null)
		.map((p) => ({
			did: p.did,
			slug: p.slug,
			name: p.name,
			version: p.latest_version,
		}));

	return {
		did,
		packs: downloadable,
	};
});

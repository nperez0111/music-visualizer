/**
 * DID/PDS resolution utilities using @atcute/identity-resolver.
 */

import {
	LocalActorResolver,
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
	DohJsonHandleResolver,
} from "@atcute/identity-resolver";

const actorResolver = new LocalActorResolver({
	handleResolver: new CompositeHandleResolver({
		methods: {
			http: new WellKnownHandleResolver(),
			dns: new DohJsonHandleResolver({
				dohUrl: "https://cloudflare-dns.com/dns-query",
			}),
		},
	}),
	didDocumentResolver: new CompositeDidDocumentResolver({
		methods: {
			plc: new PlcDidDocumentResolver(),
			web: new WebDidDocumentResolver(),
		},
	}),
});

/**
 * Resolve a DID to its PDS service endpoint URL.
 * Falls back to https://bsky.social if resolution fails.
 */
export async function resolvePdsEndpoint(did: string): Promise<string> {
	try {
		const actor = await actorResolver.resolve(did as `did:plc:${string}`);
		return actor.pds;
	} catch (err) {
		console.error(`[did] failed to resolve PDS for ${did}:`, err);
	}
	return "https://bsky.social";
}

/**
 * Resolve a DID to its verified handle.
 * Returns null if resolution fails (caller should fall back to displaying the DID).
 */
export async function resolveHandleFromDid(did: string): Promise<string | null> {
	try {
		const actor = await actorResolver.resolve(did as `did:plc:${string}`);
		return actor.handle;
	} catch {
		return null;
	}
}

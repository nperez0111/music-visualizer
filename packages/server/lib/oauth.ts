/**
 * AT Protocol OAuth client for the catnip registry server.
 * Confidential client when PRIVATE_KEY_JWK is set, public loopback otherwise.
 */

import {
	OAuthClient,
	type ClientAssertionPrivateJwk,
} from "@atcute/oauth-node-client";
import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	DohJsonHandleResolver,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
} from "@atcute/identity-resolver";
import { Client } from "@atcute/client";
import type { Did } from "@atcute/lexicons";
import { getDb } from "./db.ts";

// Scopes needed: write our custom records + upload blobs
const OAUTH_SCOPES =
	"atproto blob:*/* repo:com.nickthesick.catnip.release?action=create&action=update&action=delete repo:com.nickthesick.catnip.pack?action=create&action=update&action=delete repo:com.nickthesick.catnip.star?action=create&action=update&action=delete";

let _oauthClient: OAuthClient | null = null;

function getPublicUrl(): string {
	return process.env.CATNIP_PUBLIC_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3000}`;
}

function parseKeyset(): ClientAssertionPrivateJwk[] | undefined {
	const raw = process.env.PRIVATE_KEY_JWK;
	if (!raw) return undefined;
	try {
		const jwk = JSON.parse(raw);
		if (!jwk.alg || !jwk.kid) {
			throw new Error(
				'PRIVATE_KEY_JWK must include "alg" (e.g. "ES256") and "kid" properties',
			);
		}
		return [jwk];
	} catch (err) {
		if (err instanceof SyntaxError) {
			throw new Error("PRIVATE_KEY_JWK is set but contains invalid JSON", { cause: err });
		}
		throw err;
	}
}

function createActorResolver() {
	return new LocalActorResolver({
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
}

/**
 * SQLite-backed session store. OAuth sessions are persisted so the server
 * can act on behalf of users across restarts.
 */
function createSqliteSessionStore() {
	const db = getDb();
	db.exec(`
		CREATE TABLE IF NOT EXISTS oauth_sessions (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`);

	return {
		get: async (key: string) => {
			const row = db.prepare("SELECT value FROM oauth_sessions WHERE key = ?").get(key) as
				| { value: string }
				| null;
			if (!row) return undefined;
			return JSON.parse(row.value);
		},
		set: async (key: string, value: unknown) => {
			db.prepare(
				"INSERT INTO oauth_sessions (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
			).run(key, JSON.stringify(value));
		},
		delete: async (key: string) => {
			db.prepare("DELETE FROM oauth_sessions WHERE key = ?").run(key);
		},
		clear: async () => {
			db.prepare("DELETE FROM oauth_sessions").run();
		},
	};
}

function createSqliteStateStore() {
	const db = getDb();
	db.exec(`
		CREATE TABLE IF NOT EXISTS oauth_states (
			key        TEXT PRIMARY KEY,
			value      TEXT NOT NULL,
			expires_at INTEGER NOT NULL
		)
	`);

	return {
		get: async (key: string) => {
			// Clean expired
			db.prepare("DELETE FROM oauth_states WHERE expires_at < ?").run(Date.now());
			const row = db.prepare("SELECT value FROM oauth_states WHERE key = ?").get(key) as
				| { value: string }
				| null;
			if (!row) return undefined;
			return JSON.parse(row.value);
		},
		set: async (key: string, value: unknown) => {
			const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min TTL
			db.prepare(
				"INSERT INTO oauth_states (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
			).run(key, JSON.stringify(value), expiresAt);
		},
		delete: async (key: string) => {
			db.prepare("DELETE FROM oauth_states WHERE key = ?").run(key);
		},
		clear: async () => {
			db.prepare("DELETE FROM oauth_states").run();
		},
	};
}

export function getOAuthClient(): OAuthClient {
	if (_oauthClient) return _oauthClient;

	const baseUrl = getPublicUrl();
	const isLoopback = baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost");
	const keyset = isLoopback ? undefined : parseKeyset();

	const stores = {
		sessions: createSqliteSessionStore(),
		states: createSqliteStateStore(),
	};

	if (keyset) {
		_oauthClient = new OAuthClient({
			metadata: {
				client_id: `${baseUrl}/oauth-client-metadata.json`,
				redirect_uris: [`${baseUrl}/oauth/callback`],
				scope: OAUTH_SCOPES,
				client_uri: baseUrl,
				client_name: "Cat Nip Pack Registry",
				jwks_uri: `${baseUrl}/jwks.json`,
			},
			keyset,
			actorResolver: createActorResolver(),
			stores,
		});
	} else {
		_oauthClient = new OAuthClient({
			metadata: {
				redirect_uris: [`${baseUrl}/oauth/callback`],
				scope: OAUTH_SCOPES,
			},
			actorResolver: createActorResolver(),
			stores,
		});
	}

	return _oauthClient;
}

/**
 * Restore an OAuth session for a given DID. Returns a typed XRPC client
 * that acts on behalf of the user.
 */
export async function getSessionClient(did: string): Promise<Client> {
	const oauth = getOAuthClient();
	const session = await oauth.restore(did as Did);
	return new Client({ handler: session });
}

function requireCookieSecret(): string {
	const secret = process.env.COOKIE_SECRET;
	if (!secret) throw new Error("COOKIE_SECRET environment variable is required");
	return secret;
}

// HMAC-based session seal: token = base64url({ did, iat, sig })

/** Session token TTL: 30 days in milliseconds */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function sealSession(did: string): string {
	const secret = requireCookieSecret();
	const iat = Date.now();
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(secret);
	hasher.update(did);
	hasher.update(String(iat));
	const sig = hasher.digest("hex");
	return Buffer.from(JSON.stringify({ did, iat, sig })).toString("base64url");
}

export function unsealSession(token: string): string | null {
	try {
		const raw = JSON.parse(Buffer.from(token, "base64url").toString());
		if (!raw.did || !raw.sig) return null;
		// Reject expired tokens (tokens without iat are treated as legacy and rejected)
		if (typeof raw.iat !== "number" || Date.now() - raw.iat > SESSION_TTL_MS) return null;
		const secret = requireCookieSecret();
		const hasher = new Bun.CryptoHasher("sha256");
		hasher.update(secret);
		hasher.update(raw.did);
		hasher.update(String(raw.iat));
		const expected = hasher.digest("hex");
		// Constant-time comparison to prevent timing side-channel attacks
		const sigBuf = Buffer.from(raw.sig, "hex");
		const expectedBuf = Buffer.from(expected, "hex");
		if (sigBuf.length !== expectedBuf.length) return null;
		const { timingSafeEqual } = require("crypto") as typeof import("crypto");
		if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
		return raw.did;
	} catch {
		return null;
	}
}

/**
 * CLI auth utilities. Uses direct AT Protocol OAuth via @atcute/oauth-node-client
 * loopback flow. The CLI acts as a public OAuth client — no server involvement needed.
 *
 * OAuth sessions are persisted to ~/.config/catnip/ so the CLI can restore
 * authenticated sessions across invocations.
 *
 * Persists session DID + handle + PDS service URL to ~/.config/catnip/session.json.
 * OAuth token state is stored separately in ~/.config/catnip/oauth-sessions/
 * and ~/.config/catnip/oauth-states/ (managed by @atcute/oauth-node-client).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

import { OAuthClient } from "@atcute/oauth-node-client";
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

/** What we persist to session.json (identity only — OAuth tokens stored separately). */
export type StoredSession = {
	did: string;
	handle: string;
	/** The user's PDS service endpoint URL (e.g. https://bsky.social). */
	service: string;
	/**
	 * The redirect URI used during login (e.g. `http://127.0.0.1:62682/callback`).
	 * Must be preserved so the OAuthClient reconstructs the same `client_id`
	 * when restoring the session — the PDS binds tokens to the full client_id
	 * which includes the port number.
	 */
	redirectUri: string;
};

const CONFIG_DIR = join(homedir(), ".config", "catnip");
const SESSION_PATH = join(CONFIG_DIR, "session.json");
const OAUTH_SESSIONS_DIR = join(CONFIG_DIR, "oauth-sessions");
const OAUTH_STATES_DIR = join(CONFIG_DIR, "oauth-states");

// Scopes needed: write our custom records + upload blobs
const OAUTH_SCOPES =
	"atproto blob:*/* repo:com.nickthesick.catnip.release?action=create&action=update&action=delete repo:com.nickthesick.catnip.pack?action=create&action=update&action=delete repo:com.nickthesick.catnip.star?action=create&action=update&action=delete";

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

// ---------------------------------------------------------------------------
// File-based session + state stores for @atcute/oauth-node-client
// ---------------------------------------------------------------------------

function createFileSessionStore() {
	ensureDir(OAUTH_SESSIONS_DIR);
	return {
		get: async (key: string) => {
			const p = join(OAUTH_SESSIONS_DIR, encodeURIComponent(key) + ".json");
			if (!existsSync(p)) return undefined;
			try {
				return JSON.parse(readFileSync(p, "utf8"));
			} catch {
				return undefined;
			}
		},
		set: async (key: string, value: unknown) => {
			ensureDir(OAUTH_SESSIONS_DIR);
			const p = join(OAUTH_SESSIONS_DIR, encodeURIComponent(key) + ".json");
			writeFileSync(p, JSON.stringify(value));
		},
		delete: async (key: string) => {
			const p = join(OAUTH_SESSIONS_DIR, encodeURIComponent(key) + ".json");
			if (existsSync(p)) unlinkSync(p);
		},
		clear: async () => {
			if (existsSync(OAUTH_SESSIONS_DIR)) {
				for (const f of readdirSync(OAUTH_SESSIONS_DIR)) {
					try { unlinkSync(join(OAUTH_SESSIONS_DIR, f)); } catch {}
				}
			}
		},
	};
}

function createFileStateStore() {
	ensureDir(OAUTH_STATES_DIR);
	return {
		get: async (key: string) => {
			const p = join(OAUTH_STATES_DIR, encodeURIComponent(key) + ".json");
			if (!existsSync(p)) return undefined;
			try {
				const raw = JSON.parse(readFileSync(p, "utf8"));
				if (raw.expiresAt && raw.expiresAt < Date.now()) {
					unlinkSync(p);
					return undefined;
				}
				return raw.value;
			} catch {
				return undefined;
			}
		},
		set: async (key: string, value: unknown) => {
			ensureDir(OAUTH_STATES_DIR);
			const p = join(OAUTH_STATES_DIR, encodeURIComponent(key) + ".json");
			const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min TTL
			writeFileSync(p, JSON.stringify({ value, expiresAt }));
		},
		delete: async (key: string) => {
			const p = join(OAUTH_STATES_DIR, encodeURIComponent(key) + ".json");
			if (existsSync(p)) unlinkSync(p);
		},
		clear: async () => {
			if (existsSync(OAUTH_STATES_DIR)) {
				for (const f of readdirSync(OAUTH_STATES_DIR)) {
					try { unlinkSync(join(OAUTH_STATES_DIR, f)); } catch {}
				}
			}
		},
	};
}

// ---------------------------------------------------------------------------
// OAuth client singleton
// ---------------------------------------------------------------------------

let _oauthClient: OAuthClient | null = null;
let _currentRedirectUri: string | null = null;

/**
 * Get or create an OAuthClient configured for loopback CLI usage.
 * @param redirectUri - The redirect URI for this authorization attempt
 *   (e.g. `http://127.0.0.1:${port}/callback`). Pass the same URI
 *   used when starting the auth flow.
 */
export function getOAuthClient(redirectUri?: string): OAuthClient {
	const uri = redirectUri ?? _currentRedirectUri ?? "http://127.0.0.1:0/callback";

	// Recreate if redirect URI changed (port changes each login)
	if (_oauthClient && _currentRedirectUri === uri) return _oauthClient;

	_currentRedirectUri = uri;
	_oauthClient = new OAuthClient({
		metadata: {
			// No client_id needed — built automatically for loopback clients
			redirect_uris: [uri],
			scope: OAUTH_SCOPES,
		},
		// No keyset — public client
		actorResolver: new LocalActorResolver({
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
		}),
		stores: {
			sessions: createFileSessionStore(),
			states: createFileStateStore(),
		},
	});

	return _oauthClient;
}

// ---------------------------------------------------------------------------
// Session persistence (identity only)
// ---------------------------------------------------------------------------

export function saveSession(session: StoredSession): void {
	ensureDir(CONFIG_DIR);
	writeFileSync(SESSION_PATH, JSON.stringify(session, null, "\t") + "\n");
}

export function loadSession(): StoredSession | null {
	if (!existsSync(SESSION_PATH)) return null;
	try {
		return JSON.parse(readFileSync(SESSION_PATH, "utf8"));
	} catch {
		return null;
	}
}

export function clearSession(): void {
	// Clear identity
	if (existsSync(SESSION_PATH)) unlinkSync(SESSION_PATH);

	// Clear OAuth token stores
	for (const dir of [OAUTH_SESSIONS_DIR, OAUTH_STATES_DIR]) {
		if (existsSync(dir)) {
			for (const f of readdirSync(dir)) {
				try {
					unlinkSync(join(dir, f));
				} catch {}
			}
		}
	}
}

export function requireSession(): StoredSession {
	const session = loadSession();
	if (!session) {
		throw new Error("Not logged in. Run `catnip login` first.");
	}
	return session;
}

// ---------------------------------------------------------------------------
// Authenticated XRPC client
// ---------------------------------------------------------------------------

/**
 * Restore the OAuth session for the currently logged-in user and return
 * an authenticated XRPC `Client` instance. Tokens are automatically
 * refreshed if expired.
 *
 * Uses the stored `redirectUri` from login to reconstruct the OAuthClient
 * with the same `client_id` that the PDS originally issued tokens for.
 * Without this, token refresh fails because the PDS sees a client_id mismatch
 * (the loopback client_id includes the port number from the redirect URI).
 */
export async function getAuthenticatedClient(): Promise<Client> {
	const session = requireSession();
	const oauth = getOAuthClient(session.redirectUri);
	const oauthSession = await oauth.restore(session.did as Did);
	return new Client({ handler: oauthSession });
}

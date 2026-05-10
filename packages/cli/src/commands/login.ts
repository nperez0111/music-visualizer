import { parseArgs } from "util";
import { createServer } from "http";
import { saveSession, getOAuthClient, type StoredSession } from "../lib/auth.ts";

/**
 * `catnip login <handle>` — Log in via direct AT Protocol OAuth.
 *
 * Uses @atcute/oauth-node-client in loopback mode (public client).
 * No registry server involvement — authenticates directly with the user's PDS.
 *
 * Flow:
 * 1. Start a temporary local HTTP server on a random port
 * 2. Create a loopback OAuthClient and call authorize()
 * 3. Open browser to the PDS authorization URL
 * 4. PDS redirects back to our local server with auth code
 * 5. OAuthClient exchanges code for tokens (stored in ~/.config/catnip/oauth-sessions/)
 * 6. We store {did, handle, service} to ~/.config/catnip/session.json
 */
export async function run(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		options: {
			help: { type: "boolean", short: "h" },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log("catnip login — Log in with AT Protocol OAuth\n");
		console.log("Usage: catnip login <handle>\n");
		console.log("  handle             Your AT Protocol handle (e.g. alice.bsky.social)");
		return;
	}

	const handle = positionals[0];
	if (!handle) {
		throw new Error("Handle is required. Usage: catnip login <handle>");
	}

	// Start a local HTTP server to catch the OAuth callback
	const { port, waitForCallback, close } = await startCallbackServer();
	const redirectUri = `http://127.0.0.1:${port}/callback`;

	// Create the OAuth client with the actual redirect URI
	const oauth = getOAuthClient(redirectUri);

	// Start the authorization flow
	const { url } = await oauth.authorize({
		target: { type: "account", identifier: handle },
	});

	console.log(`Opening browser to log in as ${handle}...`);
	console.log(`If the browser doesn't open, visit: ${url.toString()}`);

	// Open browser
	try {
		const { spawnSync } = await import("child_process");
		if (process.platform === "darwin") {
			spawnSync("open", [url.toString()]);
		} else if (process.platform === "win32") {
			spawnSync("cmd", ["/c", "start", url.toString()]);
		} else {
			spawnSync("xdg-open", [url.toString()]);
		}
	} catch {
		// If we can't open, user can copy the URL
	}

	console.log("Waiting for authorization...");

	try {
		// Wait for the PDS to redirect back to our local server
		const callbackParams = await waitForCallback();

		// Exchange the authorization code for tokens
		const { session: oauthSession } = await oauth.callback(callbackParams);

		// Resolve the PDS service URL from the DID document
		const serviceUrl = await resolveServiceUrl(oauthSession.did);

		const session: StoredSession = {
			did: oauthSession.did,
			handle,
			service: serviceUrl,
		};

		saveSession(session);
		console.log(`\nLogged in as ${session.handle} (${session.did})`);
		console.log(`PDS: ${session.service}`);
		console.log("Session saved to ~/.config/catnip/");
	} finally {
		close();
	}
}

/**
 * Resolve a DID to its PDS service endpoint URL.
 */
async function resolveServiceUrl(did: string): Promise<string> {
	// For did:plc, resolve via plc.directory
	// For did:web, resolve via .well-known
	// Fall back to bsky.social as default
	try {
		if (did.startsWith("did:plc:")) {
			const resp = await fetch(`https://plc.directory/${did}`);
			if (resp.ok) {
				const doc = (await resp.json()) as {
					service?: Array<{ id: string; serviceEndpoint: string }>;
				};
				const pds = doc.service?.find(
					(s) => s.id === "#atproto_pds" || s.id === `${did}#atproto_pds`,
				);
				if (pds?.serviceEndpoint) return pds.serviceEndpoint;
			}
		}
	} catch {
		// Fall through
	}
	return "https://bsky.social";
}

type CallbackParams = URLSearchParams;

function startCallbackServer(): Promise<{
	port: number;
	waitForCallback: () => Promise<CallbackParams>;
	close: () => void;
}> {
	return new Promise((resolve, reject) => {
		let callbackResolve: (result: CallbackParams) => void;
		let callbackReject: (err: Error) => void;

		const callbackPromise = new Promise<CallbackParams>((res, rej) => {
			callbackResolve = res;
			callbackReject = rej;
		});

		const server = createServer((req, res) => {
			if (!req.url?.startsWith("/callback")) {
				res.writeHead(404);
				res.end("Not found");
				return;
			}

			const url = new URL(req.url, `http://127.0.0.1`);

			// Check for OAuth error
			const error = url.searchParams.get("error");
			if (error) {
				const desc = url.searchParams.get("error_description") ?? error;
				// HTML-escape to prevent reflected XSS from malicious PDS redirects
				const safeDesc = desc
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;");
				res.writeHead(400, { "Content-Type": "text/html" });
				res.end(
					`<html><body style="background:#000;color:#ff4444;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">` +
						`<div style="text-align:center"><h1>Login failed</h1><p>${safeDesc}</p><p>You can close this tab.</p></div>` +
						`</body></html>`,
				);
				callbackReject!(new Error(`OAuth error: ${desc}`));
				return;
			}

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(
				'<html><body style="background:#000;color:#ffd959;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">' +
					'<div style="text-align:center"><h1>Logged in!</h1><p>You can close this tab and return to the terminal.</p></div>' +
					"</body></html>",
			);

			callbackResolve!(url.searchParams);
		});

		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				reject(new Error("Failed to start callback server"));
				return;
			}

			// Auto-timeout after 5 minutes
			const timeout = setTimeout(() => {
				callbackReject!(new Error("Login timed out (5 minutes). Try again."));
				server.close();
			}, 5 * 60 * 1000);

			resolve({
				port: addr.port,
				waitForCallback: () => callbackPromise,
				close: () => {
					clearTimeout(timeout);
					server.close();
				},
			});
		});

		server.on("error", reject);
	});
}

import { defineEventHandler, getQuery, sendRedirect, createError } from "nitro/h3";
import { getOAuthClient, sealSession } from "../../lib/oauth.ts";

/**
 * OAuth callback handler. The PDS redirects here after the user authorizes.
 * If the OAuth state includes a CLI redirect_uri, we redirect back to the
 * CLI's local HTTP server with the sealed session token. Otherwise we
 * redirect to the website homepage.
 */
export default defineEventHandler(async (event) => {
	const params = getQuery(event) as Record<string, string>;
	const searchParams = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (typeof v === "string") searchParams.set(k, v);
	}

	try {
		const { session, state } = await getOAuthClient().callback(searchParams);
		const sid = sealSession(session.did);

		// If the state contains a CLI redirect_uri, redirect back to the CLI
		if (state && typeof state === "object" && "redirectUri" in state) {
			const { redirectUri, handle } = state as { redirectUri: string; handle: string };
			const redirectTo = new URL(redirectUri);

			// Only allow localhost redirects for CLI
			if (
				redirectTo.hostname !== "127.0.0.1" &&
				redirectTo.hostname !== "localhost"
			) {
				throw createError({
					statusCode: 400,
					statusMessage: "CLI redirect must be to localhost",
				});
			}

			redirectTo.searchParams.set("did", session.did);
			redirectTo.searchParams.set("handle", handle);
			redirectTo.searchParams.set("sid", sid);
			return sendRedirect(event, redirectTo.toString(), 302);
		}

		// Website login — redirect to homepage
		// TODO: Set a cookie for website sessions when that's needed
		return sendRedirect(event, "/", 302);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		throw createError({ statusCode: 400, statusMessage: `OAuth callback failed: ${msg}` });
	}
});

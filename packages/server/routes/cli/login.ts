import { defineEventHandler, getQuery, sendRedirect, createError } from "nitro/h3";
import { getOAuthClient } from "../../lib/oauth.ts";

/**
 * CLI login endpoint. The CLI opens a browser to this URL with:
 *   ?handle=alice.bsky.social&redirect_uri=http://127.0.0.1:<port>/callback
 *
 * The server initiates the OAuth flow with the user's PDS. After authorization,
 * the PDS redirects back to /oauth/callback, which redirects to the CLI's
 * local server with the sealed session token.
 */
export default defineEventHandler(async (event) => {
	const query = getQuery(event) as Record<string, string>;
	const handle = query.handle;
	const redirectUri = query.redirect_uri;

	if (!handle || typeof handle !== "string") {
		throw createError({ statusCode: 400, statusMessage: "handle parameter required" });
	}

	if (!redirectUri || typeof redirectUri !== "string") {
		throw createError({ statusCode: 400, statusMessage: "redirect_uri parameter required" });
	}

	// Validate redirect_uri is localhost
	try {
		const url = new URL(redirectUri);
		if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
			throw createError({
				statusCode: 400,
				statusMessage: "redirect_uri must be a localhost URL",
			});
		}
	} catch {
		throw createError({ statusCode: 400, statusMessage: "Invalid redirect_uri" });
	}

	const oauth = getOAuthClient();

	const { url } = await oauth.authorize({
		target: { type: "account", identifier: handle },
		state: { redirectUri, handle },
	});

	return sendRedirect(event, url.toString());
});

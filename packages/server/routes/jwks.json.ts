import { defineEventHandler, setResponseHeader, createError } from "nitro/h3";
import { getOAuthClient } from "../lib/oauth.ts";

export default defineEventHandler((event) => {
	const jwks = getOAuthClient().jwks;
	if (!jwks) throw createError({ statusCode: 404, statusMessage: "No JWKS configured" });
	setResponseHeader(event, "Cache-Control", "public, max-age=86400");
	return jwks;
});

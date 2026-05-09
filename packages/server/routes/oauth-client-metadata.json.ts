import { defineEventHandler, setResponseHeader } from "nitro/h3";
import { getOAuthClient } from "../lib/oauth.ts";

export default defineEventHandler((event) => {
	setResponseHeader(event, "Cache-Control", "public, max-age=86400");
	return getOAuthClient().metadata;
});

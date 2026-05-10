import { defineHandler } from "nitro";
import { createError } from "nitro/h3";
import { getDb } from "../../lib/db";
import { backfillMissingVersions } from "../../lib/backfill";

/**
 * POST /api/backfill
 *
 * Manually trigger version backfill for releases missing version rows.
 * Protected by ADMIN_TOKEN env var -- pass it as Bearer token.
 */
export default defineHandler(async (event) => {
	const adminToken = process.env.ADMIN_TOKEN;
	if (adminToken) {
		const auth = event.request.headers.get("authorization");
		if (auth !== `Bearer ${adminToken}`) {
			throw createError({
				statusCode: 401,
				data: { error: "Unauthorized" },
			});
		}
	}

	try {
		const db = getDb();
		const result = await backfillMissingVersions(db);
		return {
			status: "ok",
			...result,
		};
	} catch (err) {
		const message =
			err instanceof Error ? err.message : String(err);
		throw createError({
			statusCode: 500,
			data: { status: "error", error: message },
		});
	}
});

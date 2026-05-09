import { defineHandler } from "nitro";
import { createError } from "nitro/h3";
import { getDb } from "../../lib/db";

/**
 * Health check endpoint for Docker / load balancer probes.
 *
 * Returns 200 with { status: "ok" } when the server is running and
 * SQLite is accessible, or 503 with { status: "error", error: "..." }
 * if the database query fails.
 */
export default defineHandler(() => {
	try {
		const db = getDb();
		// Quick read-only query to verify the database is functional
		db.query("SELECT 1").get();
		return { status: "ok" };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw createError({ statusCode: 503, data: { status: "error", error: message } });
	}
});

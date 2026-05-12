import { defineHandler } from "nitro";
import { getDb, getAllTags } from "../../lib/db";

/**
 * GET /api/tags
 *
 * Returns all unique tags across published packs, with usage counts,
 * ordered by frequency (most-used first).
 *
 * Response: { tags: [{ tag: string, count: number }] }
 */
export default defineHandler(() => {
	const db = getDb();
	const tags = getAllTags(db);
	return { tags };
});

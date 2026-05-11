import { defineHandler } from "nitro";
import { getRouterParams, createError } from "nitro/h3";
import { getDb, type ReleaseRow, type VersionRow } from "../../../../lib/db.ts";

export default defineHandler((event) => {
	const db = getDb();
	const { did, slug } = getRouterParams(event);

	const release = db
		.prepare("SELECT * FROM releases WHERE did = ? AND rkey = ? AND hidden = 0")
		.get(did, slug) as ReleaseRow | null;

	if (!release) {
		throw createError({ statusCode: 404, statusMessage: "Pack not found" });
	}

	const versions = db
		.prepare(
			"SELECT * FROM versions WHERE release_did = ? AND release_rkey = ? ORDER BY created_at DESC",
		)
		.all(did, slug) as VersionRow[];

	const starCount = db
		.prepare(
			"SELECT COUNT(*) as count FROM stars WHERE subject_uri = ?",
		)
		.get(`at://${did}/com.nickthesick.catnip.release/${slug}`) as { count: number };

	// Collect tags from latest version
	const latestVersion = versions[0];
	let tags: string[] = [];
	if (latestVersion) {
		const tagRows = db
			.prepare("SELECT tag FROM tags WHERE version_did = ? AND version_rkey = ?")
			.all(latestVersion.did, latestVersion.rkey) as { tag: string }[];
		tags = tagRows.map((r) => r.tag);
	}

	return {
		release,
		versions,
		stars: starCount.count,
		tags,
	};
});

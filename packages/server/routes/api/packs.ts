import { defineHandler } from "nitro";
import { getQuery } from "nitro/h3";
import { getDb } from "../../lib/db.ts";

export default defineHandler((event) => {
	const db = getDb();
	const query = getQuery(event);

	const search = (query.search as string) ?? "";
	const tag = (query.tag as string) ?? "";
	const sort = (query.sort as string) ?? "newest";
	const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
	const offset = Math.max(Number(query.offset) || 0, 0);

	let sql = `
		SELECT
			r.did,
			r.rkey,
			r.name,
			r.slug,
			r.description,
			r.created_at,
			(SELECT COUNT(*) FROM stars s WHERE s.subject_uri = 'at://' || r.did || '/com.nickthesick.catnip.release/' || r.rkey) AS star_count,
			(SELECT v.version FROM versions v WHERE v.release_did = r.did AND v.release_rkey = r.rkey ORDER BY v.created_at DESC LIMIT 1) AS latest_version,
			(SELECT v.preview_path FROM versions v WHERE v.release_did = r.did AND v.release_rkey = r.rkey ORDER BY v.created_at DESC LIMIT 1) AS preview_path
		FROM releases r
		WHERE r.hidden = 0
	`;

	const params: any[] = [];

	if (search) {
		sql += " AND (r.name LIKE ? OR r.description LIKE ? OR r.slug LIKE ?)";
		const like = `%${search}%`;
		params.push(like, like, like);
	}

	if (tag) {
		sql += `
			AND EXISTS (
				SELECT 1 FROM tags t
				JOIN versions v ON v.did = t.version_did AND v.rkey = t.version_rkey
				WHERE v.release_did = r.did AND v.release_rkey = r.rkey AND t.tag = ?
			)
		`;
		params.push(tag);
	}

	if (sort === "stars") {
		sql += " ORDER BY star_count DESC, r.created_at DESC";
	} else {
		sql += " ORDER BY r.created_at DESC";
	}

	sql += " LIMIT ? OFFSET ?";
	params.push(limit, offset);

	const rows = db.prepare(sql).all(...params);
	return { packs: rows };
});

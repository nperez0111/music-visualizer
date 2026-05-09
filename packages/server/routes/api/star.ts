import { defineEventHandler, readBody, createError, getHeader } from "nitro/h3";
import { unsealSession, getSessionClient } from "../../lib/oauth.ts";
import { starLimiter } from "../../lib/rate-limit.ts";
import { getDb } from "../../lib/db.ts";

/**
 * POST /api/star — Star or unstar a release.
 *
 * Body: { subject: "at://did:plc:xxx/com.nickthesick.catnip.release/slug", action: "star" | "unstar" }
 *
 * Auth: Bearer token in Authorization header (sealed session).
 *
 * Stars create a com.nickthesick.catnip.star record on the user's PDS.
 * Unstars delete the matching record.
 */
export default defineEventHandler(async (event) => {
	// Authenticate
	const authHeader = getHeader(event, "authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		throw createError({ statusCode: 401, statusMessage: "Authorization required" });
	}

	const token = authHeader.slice(7);
	const did = unsealSession(token);
	if (!did) {
		throw createError({ statusCode: 401, statusMessage: "Invalid or expired session" });
	}

	// Rate limit
	if (!starLimiter.check(did)) {
		throw createError({ statusCode: 429, statusMessage: "Rate limited. Try again later." });
	}

	const body = await readBody(event);
	const { subject, action } = body ?? {};

	if (!subject || typeof subject !== "string") {
		throw createError({ statusCode: 400, statusMessage: "subject (AT-URI) required" });
	}

	if (action !== "star" && action !== "unstar") {
		throw createError({ statusCode: 400, statusMessage: "action must be 'star' or 'unstar'" });
	}

	// Validate subject is a release URI
	const match = subject.match(/^at:\/\/(did:[^/]+)\/com\.nickthesick\.catnip\.release\/([^/]+)$/);
	if (!match) {
		throw createError({ statusCode: 400, statusMessage: "subject must be a catnip release AT-URI" });
	}

	const client = await getSessionClient(did);

	if (action === "star") {
		const now = new Date().toISOString();

		await client.post("com.atproto.repo.createRecord", {
			input: {
				repo: did,
				collection: "com.nickthesick.catnip.star",
				record: {
					$type: "com.nickthesick.catnip.star",
					subject,
					createdAt: now,
				},
			},
		});

		return { ok: true, action: "star", subject };
	} else {
		// Look up the star rkey from the local index instead of listing PDS records
		const db = getDb();
		const row = db
			.prepare("SELECT rkey FROM stars WHERE did = ? AND subject_uri = ?")
			.get(did, subject) as { rkey: string } | null;

		if (row) {
			await client.post("com.atproto.repo.deleteRecord", {
				input: {
					repo: did,
					collection: "com.nickthesick.catnip.star",
					rkey: row.rkey,
				},
			});
		}

		return { ok: true, action: "unstar", subject };
	}
});

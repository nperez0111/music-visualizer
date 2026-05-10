import { definePlugin as defineNitroPlugin } from "nitro";
import { JetstreamSubscription } from "@atcute/jetstream";
import {
	getDb,
	upsertRelease,
	upsertVersion,
	upsertStar,
	deleteRelease,
	deleteVersion,
	deleteStar,
	setVersionTags,
	getCursor,
	setCursor,
	getVersionsMissingPreview,
} from "../lib/db.ts";
import { renderVersionPreview } from "../lib/preview.ts";
import { indexerVersionLimiter } from "../lib/rate-limit.ts";
import { backfillMissingVersions, parseAtUri } from "../lib/backfill.ts";

const COLLECTIONS = [
	"com.nickthesick.catnip.release",
	"com.nickthesick.catnip.pack",
	"com.nickthesick.catnip.star",
] as const;

// ── Record validation helpers (enforce lexicon constraints before DB insert) ──

const AT_URI_RE = /^at:\/\/did:[^/]+\/[^/]+\/[^/]+$/;
const SLUG_RE = /^[a-z][a-z0-9-]*$/;

function isString(v: unknown, maxLen: number): v is string {
	return typeof v === "string" && v.length > 0 && v.length <= maxLen;
}

function validateReleaseRecord(record: any): boolean {
	if (!isString(record.name, 256)) return false;
	if (!isString(record.slug, 128) || !SLUG_RE.test(record.slug)) return false;
	if (record.description != null && (typeof record.description !== "string" || record.description.length > 2048))
		return false;
	if (record.createdAt != null && typeof record.createdAt !== "string") return false;
	// Validate tags if present
	if (record.tags != null) {
		if (!Array.isArray(record.tags) || record.tags.length > 10) return false;
		for (const tag of record.tags) {
			if (typeof tag !== "string" || tag.length === 0 || tag.length > 64) return false;
		}
	}
	return true;
}

function validatePackRecord(record: any): boolean {
	if (!isString(record.release, 512) || !AT_URI_RE.test(record.release)) return false;
	if (!isString(record.version, 64)) return false;
	if (record.createdAt != null && typeof record.createdAt !== "string") return false;
	if (record.changelog != null && (typeof record.changelog !== "string" || record.changelog.length > 4096))
		return false;
	// viz blob ref is optional at the record level (checked separately)
	return true;
}

function validateStarRecord(record: any): boolean {
	if (!isString(record.subject, 512) || !AT_URI_RE.test(record.subject)) return false;
	if (record.createdAt != null && typeof record.createdAt !== "string") return false;
	return true;
}

/** Maximum concurrent preview renders. Excess is dropped (not queued). */
const MAX_CONCURRENT_RENDERS = 2;
let activeRenders = 0;

export default defineNitroPlugin(() => {
	if (process.env.CATNIP_DISABLE_INDEXER === "1") return;

	const db = getDb();
	const cursor = getCursor(db);

	const jetstream = new JetstreamSubscription({
		url: "wss://jetstream2.us-east.bsky.network",
		wantedCollections: [...COLLECTIONS],
		cursor: cursor || undefined,
		onConnectionOpen: () => console.log("[indexer] connected to Jetstream"),
		onConnectionError: (err) => console.error("[indexer] jetstream error:", err),
	});

	(async () => {
		try {
			for await (const event of jetstream) {
				try {
					handleEvent(event);
				} catch (err) {
					console.error("[indexer] error handling event:", err);
				}
			}
		} catch (err) {
			console.error("[indexer] jetstream loop terminated:", err);
		}
	})();

	// Backfill: fetch version records from PDS for releases missing versions,
	// then re-render any missing previews.
	setTimeout(async () => {
		await backfillMissingVersions(db);

		const missing = getVersionsMissingPreview(db);
		if (missing.length === 0) return;
		console.log(`[indexer] re-rendering ${missing.length} missing preview(s)`);
		for (const { did, rkey, viz_cid } of missing) {
			try {
				await renderVersionPreview({ did, rkey, vizCid: viz_cid });
			} catch (err) {
				console.error(`[indexer] re-render failed for ${did}/${rkey}:`, err);
			}
		}
	}, 5_000); // Delay 5s to let the server fully start
});

function handleEvent(event: any): void {
	const db = getDb();
	const { did, time_us, type, collection, rkey, record } = parseEvent(event);

	if (!collection || !COLLECTIONS.includes(collection as any)) return;

	if (type === "create" || type === "update") {
		switch (collection) {
			case "com.nickthesick.catnip.release":
				if (!validateReleaseRecord(record)) {
					console.warn(`[indexer] dropping invalid release record from ${did}/${rkey}`);
					break;
				}
				upsertRelease(db, {
					did,
					rkey,
					name: record.name,
					slug: record.slug,
					description: record.description,
					created_at: record.createdAt,
				});
				// Index tags from the release record (if present)
				if (Array.isArray(record.tags) && record.tags.length > 0) {
					// Tags are stored against the release identity. We also
					// propagate them to the latest version row so existing
					// tag-based queries still work. We store on the release
					// rkey using did + rkey to find the latest version.
					const latestVersion = db
						.prepare(
							"SELECT did, rkey FROM versions WHERE release_did = ? AND release_rkey = ? ORDER BY created_at DESC LIMIT 1",
						)
						.get(did, rkey) as { did: string; rkey: string } | null;
					if (latestVersion) {
						setVersionTags(db, latestVersion.did, latestVersion.rkey, record.tags);
					}
				}
				break;

			case "com.nickthesick.catnip.pack": {
				if (!validatePackRecord(record)) {
					console.warn(`[indexer] dropping invalid pack record from ${did}/${rkey}`);
					break;
				}

				// Per-DID rate limiting: drop excess versions (20/hr)
				if (!indexerVersionLimiter.check(did)) {
					console.warn(`[indexer] rate limit exceeded for ${did}, dropping pack version ${rkey}`);
					break;
				}

				// Parse the release AT-URI to get the release did + rkey
				const releaseUri = parseAtUri(record.release);
				if (!releaseUri) break;

				// With slug:version rkey format, extract version from rkey
				// rkey format: "slug:version" (e.g. "neon-cruise:1.2.0")
				const vizCid = record.viz?.ref?.$link ?? "";
				upsertVersion(db, {
					did,
					rkey,
					release_did: releaseUri.did,
					release_rkey: releaseUri.rkey,
					version: record.version,
					viz_cid: vizCid,
					changelog: record.changelog,
					created_at: record.createdAt,
				});

				// Render preview asynchronously with concurrency limit
				if (vizCid) {
					if (activeRenders < MAX_CONCURRENT_RENDERS) {
						activeRenders++;
						renderVersionPreview({ did, rkey, vizCid })
							.catch((err) => {
								console.error(`[indexer] preview render error for ${did}/${rkey}:`, err);
							})
							.finally(() => {
								activeRenders--;
							});
					} else {
						console.warn(`[indexer] preview render queue full, skipping ${did}/${rkey}`);
					}
				}
				break;
			}

			case "com.nickthesick.catnip.star":
				if (!validateStarRecord(record)) {
					console.warn(`[indexer] dropping invalid star record from ${did}/${rkey}`);
					break;
				}
				upsertStar(db, {
					did,
					rkey,
					subject_uri: record.subject,
					created_at: record.createdAt,
				});
				break;
		}
	} else if (type === "delete") {
		switch (collection) {
			case "com.nickthesick.catnip.release":
				deleteRelease(db, did, rkey);
				break;
			case "com.nickthesick.catnip.pack":
				deleteVersion(db, did, rkey);
				break;
			case "com.nickthesick.catnip.star":
				deleteStar(db, did, rkey);
				break;
		}
	}

	// Persist cursor
	if (time_us) {
		setCursor(db, time_us);
	}
}

function parseEvent(event: any): {
	did: string;
	time_us: number;
	type: string;
	collection: string;
	rkey: string;
	record: any;
} {
	// @atcute/jetstream v1.1 event shape:
	//   { kind: 'commit', did, time_us, commit: { operation, collection, rkey, record? } }
	const commit = event.commit;
	return {
		did: event.did ?? "",
		time_us: event.time_us ?? 0,
		type: commit?.operation ?? event.type ?? "",
		collection: commit?.collection ?? event.collection ?? "",
		rkey: commit?.rkey ?? event.rkey ?? "",
		record: commit?.record ?? event.record ?? {},
	};
}



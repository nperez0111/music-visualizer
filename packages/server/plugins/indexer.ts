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
} from "../lib/db.ts";
import { renderVersionPreview } from "../lib/preview.ts";
import { indexerVersionLimiter } from "../lib/rate-limit.ts";

const COLLECTIONS = [
	"com.nickthesick.catnip.release",
	"com.nickthesick.catnip.pack",
	"com.nickthesick.catnip.star",
] as const;

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
});

function handleEvent(event: any): void {
	const db = getDb();
	const { did, time_us, type, collection, rkey, record } = parseEvent(event);

	if (!collection || !COLLECTIONS.includes(collection as any)) return;

	if (type === "create" || type === "update") {
		switch (collection) {
			case "com.nickthesick.catnip.release":
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
	return {
		did: event.did ?? "",
		time_us: event.time_us ?? 0,
		type: event.type ?? event.commit?.type ?? "",
		collection: event.collection ?? event.commit?.collection ?? "",
		rkey: event.rkey ?? event.commit?.rkey ?? "",
		record: event.commit?.record ?? event.record ?? {},
	};
}

function parseAtUri(uri: string): { did: string; collection: string; rkey: string } | null {
	// at://did:plc:xxx/com.nickthesick.catnip.release/slug
	const match = uri?.match(/^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/);
	if (!match) return null;
	return { did: match[1], collection: match[2], rkey: match[3] };
}

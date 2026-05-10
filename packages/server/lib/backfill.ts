import {
	getReleasesWithoutVersions,
	upsertVersion,
	type getDb,
} from "./db.ts";
import { resolvePdsEndpoint } from "./did.ts";
import { Client, ok, simpleFetchHandler } from "@atcute/client";

const AT_URI_RE = /^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/;

export function parseAtUri(
	uri: string,
): { did: string; collection: string; rkey: string } | null {
	const match = uri?.match(AT_URI_RE);
	if (!match) return null;
	return { did: match[1], collection: match[2], rkey: match[3] };
}

function validatePackRecord(record: any): boolean {
	const isString = (v: unknown, maxLen: number): v is string =>
		typeof v === "string" && v.length > 0 && v.length <= maxLen;

	if (!isString(record.release, 512) || !AT_URI_RE.test(record.release))
		return false;
	if (!isString(record.version, 64)) return false;
	if (
		record.createdAt != null &&
		typeof record.createdAt !== "string"
	)
		return false;
	if (
		record.changelog != null &&
		(typeof record.changelog !== "string" ||
			record.changelog.length > 4096)
	)
		return false;
	return true;
}

export interface BackfillResult {
	orphanCount: number;
	filled: number;
	errors: string[];
}

/**
 * Fetch version records from PDS for releases that have no version rows
 * in the local DB. Returns detailed results for observability.
 */
export async function backfillMissingVersions(
	db: ReturnType<typeof getDb>,
): Promise<BackfillResult> {
	const result: BackfillResult = { orphanCount: 0, filled: 0, errors: [] };

	const orphanReleases = getReleasesWithoutVersions(db);
	result.orphanCount = orphanReleases.length;
	if (orphanReleases.length === 0) return result;

	// Group by DID to minimize PDS requests
	const byDid = new Map<string, string[]>();
	for (const { did, rkey } of orphanReleases) {
		const list = byDid.get(did);
		if (list) list.push(rkey);
		else byDid.set(did, [rkey]);
	}

	console.log(
		`[backfill] backfilling versions for ${orphanReleases.length} release(s) across ${byDid.size} DID(s)`,
	);

	for (const [did, rkeys] of byDid) {
		try {
			const pdsUrl = await resolvePdsEndpoint(did);
			const client = new Client({
				handler: simpleFetchHandler({ service: pdsUrl }),
			});

			type Did = `did:${string}:${string}`;

			// Paginate through all pack records for this DID
			let cursor: string | undefined;
			const allRecords: Array<{
				uri: string;
				value: Record<string, unknown>;
			}> = [];
			do {
				const page = await ok(
					client.get("com.atproto.repo.listRecords", {
						params: {
							repo: did as Did,
							collection: "com.nickthesick.catnip.pack",
							limit: 100,
							...(cursor ? { cursor } : {}),
						},
					}),
				);
				allRecords.push(
					...(page.records as typeof allRecords),
				);
				cursor = page.cursor;
			} while (cursor);

			// Match records to orphan releases
			const rkeysSet = new Set(rkeys);
			for (const rec of allRecords) {
				const record = rec.value as any;
				if (!validatePackRecord(record)) continue;

				const releaseUri = parseAtUri(record.release);
				if (!releaseUri || !rkeysSet.has(releaseUri.rkey))
					continue;

				const rkey = rec.uri.split("/").pop()!;
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
				result.filled++;
			}
		} catch (err) {
			const msg = `DID ${did}: ${err instanceof Error ? err.message : String(err)}`;
			console.error(`[backfill] failed for ${did}:`, err);
			result.errors.push(msg);
		}
	}

	console.log(
		`[backfill] done: ${result.filled}/${result.orphanCount} filled, ${result.errors.length} error(s)`,
	);
	return result;
}

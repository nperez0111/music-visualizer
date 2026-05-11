import { defineHandler } from "nitro";
import { useStorage } from "nitro/storage";
import { createError, createEventStream } from "nitro/h3";
import { getDb, getVersionsWithPreview, clearVersionPreview, getVersionsMissingPreview } from "../../lib/db";
import { backfillMissingVersions, refreshAllVersions } from "../../lib/backfill";
import { renderVersionPreview } from "../../lib/preview";

/**
 * GET /api/backfill
 *
 * Server-Sent Events endpoint that streams progress for:
 * 1. Version backfill for releases missing version rows
 * 2. CID refresh from PDS (fixes stale CIDs from re-publishes)
 * 3. Preview repair: clear orphaned preview_path entries, re-render missing
 *
 * Protected by ADMIN_TOKEN env var -- pass it as Bearer token.
 *
 * Events:
 *   step       - Starting a new phase { phase, message }
 *   progress   - Progress within a phase { phase, current, total, detail? }
 *   error      - Non-fatal error { phase, message }
 *   done       - All phases complete { summary }
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

	const stream = createEventStream(event);

	const send = (type: string, data: Record<string, unknown>) =>
		stream.push({ event: type, data: JSON.stringify(data) });

	// Run the pipeline asynchronously so events stream as work happens
	(async () => {
		try {
			const db = getDb();

			// --- Phase 1: Backfill orphan releases ---
			await send("step", { phase: "backfill", message: "Backfilling missing version rows..." });
			const versionResult = await backfillMissingVersions(db);
			await send("progress", {
				phase: "backfill",
				current: versionResult.filled,
				total: versionResult.orphanCount,
				detail: `${versionResult.filled}/${versionResult.orphanCount} filled`,
			});
			for (const err of versionResult.errors) {
				await send("error", { phase: "backfill", message: err });
			}

			// --- Phase 2: Refresh CIDs ---
			await send("step", { phase: "refresh", message: "Refreshing version CIDs from PDS..." });
			const refreshResult = await refreshAllVersions(db);
			await send("progress", {
				phase: "refresh",
				current: refreshResult.upserted,
				total: refreshResult.upserted,
				detail: `${refreshResult.upserted} upserted across ${refreshResult.didCount} DID(s)`,
			});
			for (const err of refreshResult.errors) {
				await send("error", { phase: "refresh", message: err });
			}

			// --- Phase 3: Verify preview files ---
			await send("step", { phase: "previews:verify", message: "Checking preview files in storage..." });
			const withPreview = getVersionsWithPreview(db);
			const storage = useStorage("previews");
			let orphanedPreviews = 0;
			for (let i = 0; i < withPreview.length; i++) {
				const v = withPreview[i];
				const exists = await storage.hasItem(v.preview_path);
				if (!exists) {
					clearVersionPreview(db, v.did, v.rkey);
					orphanedPreviews++;
				}
			}
			await send("progress", {
				phase: "previews:verify",
				current: withPreview.length,
				total: withPreview.length,
				detail: `${withPreview.length} checked, ${orphanedPreviews} orphaned cleared`,
			});

			// --- Phase 4: Render missing previews ---
			const toRender = getVersionsMissingPreview(db);
			await send("step", {
				phase: "previews:render",
				message: `Rendering ${toRender.length} missing preview(s)...`,
			});

			let rendered = 0;
			const renderErrors: string[] = [];
			for (let i = 0; i < toRender.length; i++) {
				const { did, rkey, viz_cid } = toRender[i];
				try {
					await renderVersionPreview({ did, rkey, vizCid: viz_cid });
					rendered++;
					await send("progress", {
						phase: "previews:render",
						current: rendered,
						total: toRender.length,
						detail: `${did.slice(0, 20)}.../${rkey}`,
					});
				} catch (err) {
					const msg = `${did}/${rkey}: ${err instanceof Error ? err.message : String(err)}`;
					renderErrors.push(msg);
					await send("error", { phase: "previews:render", message: msg });
				}
			}

			// --- Done ---
			await send("done", {
				summary: {
					versions: versionResult,
					refresh: refreshResult,
					previews: {
						checkedFiles: withPreview.length,
						orphanedCleared: orphanedPreviews,
						rendered,
						renderErrors,
					},
				},
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await send("error", { phase: "fatal", message });
		} finally {
			await stream.close();
		}
	})();

	return stream.send();
});

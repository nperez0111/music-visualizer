import { defineHandler } from "nitro";
import { useStorage } from "nitro/storage";
import { createError } from "nitro/h3";
import { getDb, getVersionsWithPreview, clearVersionPreview, getVersionsMissingPreview } from "../../lib/db";
import { backfillMissingVersions } from "../../lib/backfill";
import { renderVersionPreview } from "../../lib/preview";

/**
 * GET /api/backfill
 *
 * Manually trigger:
 * 1. Version backfill for releases missing version rows
 * 2. Preview repair: clear preview_path for versions whose file is missing
 *    from storage, then re-render them
 *
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

		// Step 1: Backfill missing version rows
		const versionResult = await backfillMissingVersions(db);

		// Step 2: Find versions with preview_path set but file missing from storage
		const withPreview = getVersionsWithPreview(db);
		const storage = useStorage("previews");
		let orphanedPreviews = 0;
		for (const v of withPreview) {
			const exists = await storage.hasItem(v.preview_path);
			if (!exists) {
				clearVersionPreview(db, v.did, v.rkey);
				orphanedPreviews++;
			}
		}

		// Step 3: Re-render all versions now missing previews
		const toRender = getVersionsMissingPreview(db);
		let rendered = 0;
		const renderErrors: string[] = [];
		for (const { did, rkey, viz_cid } of toRender) {
			try {
				await renderVersionPreview({ did, rkey, vizCid: viz_cid });
				rendered++;
			} catch (err) {
				const msg = `${did}/${rkey}: ${err instanceof Error ? err.message : String(err)}`;
				renderErrors.push(msg);
			}
		}

		return {
			status: "ok",
			versions: versionResult,
			previews: {
				checkedFiles: withPreview.length,
				orphanedCleared: orphanedPreviews,
				rendered,
				renderErrors,
			},
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

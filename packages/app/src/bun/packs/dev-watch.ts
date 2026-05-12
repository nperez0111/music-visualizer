import { watch, type FSWatcher } from "fs";
import { join, resolve } from "path";
import { loadPacksFromDir, type Pack } from "./loader";

export type PackChange = {
	/** Directory name under packsDir, NOT necessarily the pack id. */
	dirName: string;
	/** Files touched since the last flush (basenames only). */
	touched: Set<string>;
	/** Re-validated pack, or null if the manifest/shader is now invalid. */
	fresh: Pack | null;
};

type Bucket = { timer: ReturnType<typeof setTimeout>; touched: Set<string> };

/**
 * Watch a packs source directory and call `onPackChanged` whenever a pack's
 * manifest, shader, or wasm file changes. Events are debounced per-directory
 * (editors often fire 2–3 events per save).
 *
 * Returns a stop function. The watcher is best-effort: errors are logged but
 * never thrown.
 */
export function watchPacksDir(opts: {
	packsDir: string;
	debounceMs?: number;
	onPackChanged: (change: PackChange) => void;
}): () => void {
	const { packsDir, onPackChanged } = opts;
	const debounceMs = opts.debounceMs ?? 80;
	const buckets = new Map<string, Bucket>();

	const flush = (dirName: string) => {
		const bucket = buckets.get(dirName);
		if (!bucket) return;
		buckets.delete(dirName);
		const all = loadPacksFromDir(packsDir);
		const fresh = all.find((p) => resolve(p.path) === resolve(join(packsDir, dirName))) ?? null;
		try {
			onPackChanged({ dirName, touched: bucket.touched, fresh });
		} catch (err) {
			console.error("[packs] hot-reload handler error:", err);
		}
	};

	let watcher: FSWatcher;
	try {
		watcher = watch(packsDir, { recursive: true }, (_event, filename) => {
			if (!filename) return;
			const parts = filename.split(/[\\/]/);
			if (parts.length < 2) return;
			const dirName = parts[0];
			const file = parts[parts.length - 1];
			if (file !== "manifest.json" && !file.endsWith(".wgsl") && !file.endsWith(".wasm")) return;

			let bucket = buckets.get(dirName);
			if (!bucket) {
				bucket = { timer: setTimeout(() => flush(dirName), debounceMs), touched: new Set() };
				buckets.set(dirName, bucket);
			} else {
				clearTimeout(bucket.timer);
				bucket.timer = setTimeout(() => flush(dirName), debounceMs);
			}
			bucket.touched.add(file);
		});
	} catch (err) {
		console.warn(`[packs] hot-reload disabled — watch failed:`, err);
		return () => {};
	}

	return () => {
		for (const b of buckets.values()) clearTimeout(b.timer);
		buckets.clear();
		try { watcher.close(); } catch {}
	};
}

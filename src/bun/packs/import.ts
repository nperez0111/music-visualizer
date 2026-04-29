import { unzipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export type ImportResult =
	| { ok: true; id: string; installPath: string }
	| { ok: false; error: string };

/**
 * Extract a .viz archive (zip with manifest.json at root or one nested level
 * deep) into `<userPacksDir>/<id>/`. Returns the pack id on success.
 *
 * If a pack with the same id already exists, it's replaced — the user
 * confirmed the import via the file dialog, that's an explicit overwrite.
 */
export function importVizFile(sourceFile: string, userPacksDir: string): ImportResult {
	if (!existsSync(sourceFile)) return { ok: false, error: "source file not found" };

	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(readFileSync(sourceFile));
	} catch (err) {
		return { ok: false, error: `failed to read file: ${err}` };
	}

	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(bytes);
	} catch (err) {
		return { ok: false, error: `not a valid .viz / zip: ${err}` };
	}

	// Find manifest.json: at root or one level deep (some zip tools nest a
	// single-folder wrapper).
	const keys = Object.keys(entries);
	const manifestKey = keys.find(
		(k) => k === "manifest.json" || /^[^\/]+\/manifest\.json$/.test(k),
	);
	if (!manifestKey) return { ok: false, error: "manifest.json not found in archive" };

	let manifest: { id?: unknown };
	try {
		manifest = JSON.parse(new TextDecoder().decode(entries[manifestKey]!));
	} catch (err) {
		return { ok: false, error: `manifest.json is not valid JSON: ${err}` };
	}

	if (typeof manifest.id !== "string" || !/^[a-z0-9_-]{1,64}$/i.test(manifest.id)) {
		return { ok: false, error: "manifest.id missing or invalid" };
	}
	const id = manifest.id;
	const installPath = join(userPacksDir, id);

	const prefix = manifestKey === "manifest.json"
		? ""
		: manifestKey.slice(0, -"/manifest.json".length) + "/";

	if (existsSync(installPath)) rmSync(installPath, { recursive: true, force: true });
	mkdirSync(installPath, { recursive: true });

	for (const [path, data] of Object.entries(entries)) {
		if (prefix && !path.startsWith(prefix)) continue;
		const rel = path.slice(prefix.length);
		if (!rel || rel.endsWith("/")) continue; // directories
		// Reject path traversal attempts.
		if (rel.includes("..") || rel.startsWith("/")) {
			return { ok: false, error: `archive contains unsafe path: ${path}` };
		}
		const dst = join(installPath, rel);
		mkdirSync(dirname(dst), { recursive: true });
		writeFileSync(dst, data);
	}

	return { ok: true, id, installPath };
}

export function removeUserPack(userPacksDir: string, id: string): boolean {
	if (!/^[a-z0-9_-]{1,64}$/i.test(id)) return false;
	const dir = join(userPacksDir, id);
	if (!existsSync(dir)) return false;
	rmSync(dir, { recursive: true, force: true });
	return true;
}

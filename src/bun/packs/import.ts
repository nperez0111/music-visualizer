import { unzipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { computePackHashFromEntries, isPackHash } from "./hash";
import { PACK_LIMITS } from "./limits";
import { validateManifest } from "./loader";

export type ImportResult =
	| { ok: true; id: string; installPath: string }
	| { ok: false; error: string };

const UNSAFE_PATH = /(^|[\\\/])\.\.([\\\/]|$)|\\|\0/;

function isUnsafePath(rel: string): boolean {
	if (!rel) return true;
	if (rel.startsWith("/")) return true;
	if (rel.includes("..")) return true;
	if (rel.includes("\\")) return true;
	if (rel.includes("\0")) return true;
	// Belt-and-suspenders against a future regex change.
	return UNSAFE_PATH.test(rel);
}

/**
 * Extract a `.viz` archive (zip with manifest.json at root or one nested level
 * deep) into `<userPacksDir>/<sha256>/`. Returns the content-addressed pack id
 * on success.
 *
 * Marketplace-safety rules enforced here:
 *  - archive size, entry count, per-entry size, and total expanded size
 *    are capped (see PACK_LIMITS).
 *  - any entry path containing `..`, `\`, or `\0`, or starting with `/`,
 *    aborts the import.
 *  - install location is the SHA-256 of the canonical pack record, NOT a
 *    publisher-chosen name — so an upload cannot squat or silently
 *    overwrite an existing pack.
 *  - manifest validity is checked (rejecting the import if invalid) before
 *    any files are written to disk.
 */
export function importVizFile(sourceFile: string, userPacksDir: string): ImportResult {
	if (!existsSync(sourceFile)) return { ok: false, error: "source file not found" };

	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(readFileSync(sourceFile));
	} catch (err) {
		return { ok: false, error: `failed to read file: ${err}` };
	}

	if (bytes.byteLength > PACK_LIMITS.MAX_ARCHIVE_BYTES) {
		return {
			ok: false,
			error: `archive too large (${bytes.byteLength} > ${PACK_LIMITS.MAX_ARCHIVE_BYTES} bytes)`,
		};
	}

	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(bytes);
	} catch (err) {
		return { ok: false, error: `not a valid .viz / zip: ${err}` };
	}

	const allKeys = Object.keys(entries);
	const fileKeys = allKeys.filter((k) => !k.endsWith("/"));
	if (fileKeys.length > PACK_LIMITS.MAX_ENTRY_COUNT) {
		return {
			ok: false,
			error: `too many entries (${fileKeys.length} > ${PACK_LIMITS.MAX_ENTRY_COUNT})`,
		};
	}
	let totalUncompressed = 0;
	for (const k of fileKeys) {
		const sz = entries[k]!.byteLength;
		if (sz > PACK_LIMITS.MAX_ENTRY_BYTES) {
			return { ok: false, error: `entry "${k}" too large (${sz} bytes)` };
		}
		totalUncompressed += sz;
		if (totalUncompressed > PACK_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
			return {
				ok: false,
				error: `archive expands beyond ${PACK_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES} bytes`,
			};
		}
	}

	// Find manifest.json: at root or one level deep (some zip tools nest a
	// single-folder wrapper).
	const manifestKey = allKeys.find(
		(k) => k === "manifest.json" || /^[^\/]+\/manifest\.json$/.test(k),
	);
	if (!manifestKey) return { ok: false, error: "manifest.json not found in archive" };

	const prefix = manifestKey === "manifest.json"
		? ""
		: manifestKey.slice(0, -"/manifest.json".length) + "/";

	let manifestRaw: unknown;
	try {
		manifestRaw = JSON.parse(new TextDecoder().decode(entries[manifestKey]!));
	} catch (err) {
		return { ok: false, error: `manifest.json is not valid JSON: ${err}` };
	}

	const v = validateManifest(manifestRaw);
	if (!v.ok) return { ok: false, error: `manifest invalid: ${v.err}` };

	// Validate every relative path before we compute the hash — even paths we'd
	// skip below shouldn't be in the archive in the first place.
	for (const path of allKeys) {
		if (path.endsWith("/")) continue;
		if (prefix && !path.startsWith(prefix)) continue;
		const rel = path.slice(prefix.length);
		if (isUnsafePath(rel)) {
			return { ok: false, error: `archive contains unsafe path: ${path}` };
		}
	}

	// Hash the canonical pack record (relPath + content) — never the publisher's
	// claimed manifest.id.
	const id = computePackHashFromEntries(entries, prefix);
	const installPath = join(userPacksDir, id);

	// If the same content is already installed, the install is idempotent —
	// we still wipe and re-extract so a partial prior write doesn't linger.
	if (existsSync(installPath)) rmSync(installPath, { recursive: true, force: true });
	mkdirSync(installPath, { recursive: true });

	for (const [path, data] of Object.entries(entries)) {
		if (prefix && !path.startsWith(prefix)) continue;
		const rel = path.slice(prefix.length);
		if (!rel || rel.endsWith("/")) continue;
		if (isUnsafePath(rel)) {
			rmSync(installPath, { recursive: true, force: true });
			return { ok: false, error: `archive contains unsafe path: ${path}` };
		}
		const dst = join(installPath, rel);
		mkdirSync(dirname(dst), { recursive: true });
		writeFileSync(dst, data);
	}

	return { ok: true, id, installPath };
}

export function removeUserPack(userPacksDir: string, id: string): boolean {
	if (!isPackHash(id)) return false;
	const dir = join(userPacksDir, id);
	if (!existsSync(dir)) return false;
	rmSync(dir, { recursive: true, force: true });
	return true;
}

// Content-addressed pack hashing. The portable entrypoint is
// computePackHash() which works on in-memory entries. The filesystem
// variant computePackHashFromDir() is provided for convenience but
// requires Node/Bun fs.

import { createHash } from "crypto";

function combine(records: Array<{ relPath: string; bytes: Uint8Array }>): string {
	records.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
	const outer = createHash("sha256");
	for (const r of records) {
		const innerName = createHash("sha256").update(r.relPath).digest("hex");
		const innerContent = createHash("sha256").update(r.bytes).digest("hex");
		outer.update(`${innerName}:${innerContent}\n`);
	}
	return outer.digest("hex");
}

/**
 * Compute the content-addressed pack hash from an in-memory map of
 * { relativePath -> bytes }. manifest.json is automatically excluded.
 * Paths should use POSIX separators.
 */
export function computePackHash(entries: Record<string, Uint8Array>, prefix = ""): string {
	const records: Array<{ relPath: string; bytes: Uint8Array }> = [];
	for (const [path, bytes] of Object.entries(entries)) {
		if (path.endsWith("/")) continue;
		if (prefix && !path.startsWith(prefix)) continue;
		const rel = path.slice(prefix.length).replace(/\\/g, "/");
		if (!rel || rel === "manifest.json") continue;
		records.push({ relPath: rel, bytes });
	}
	return combine(records);
}

/**
 * Compute the content-addressed pack hash by walking a directory on disk.
 * manifest.json is excluded from the hash.
 */
export function computePackHashFromDir(dir: string): string {
	// Dynamic import avoidance — these are always available in Node/Bun.
	const { readdirSync, readFileSync, statSync } = require("fs");
	const { join } = require("path");

	function listFilesRecursive(
		root: string,
		prefix: string,
		out: Array<{ relPath: string; fullPath: string }>,
	): void {
		for (const name of readdirSync(root)) {
			const full = join(root, name);
			const st = statSync(full);
			const rel = prefix ? `${prefix}/${name}` : name;
			if (st.isDirectory()) listFilesRecursive(full, rel, out);
			else if (st.isFile()) out.push({ relPath: rel, fullPath: full });
		}
	}

	const files: Array<{ relPath: string; fullPath: string }> = [];
	listFilesRecursive(dir, "", files);
	const records = files
		.filter((f) => f.relPath !== "manifest.json")
		.map((f) => ({ relPath: f.relPath, bytes: readFileSync(f.fullPath) }));
	return combine(records);
}

const HEX64_RE = /^[0-9a-f]{64}$/;
export function isPackHash(s: string): boolean {
	return HEX64_RE.test(s);
}

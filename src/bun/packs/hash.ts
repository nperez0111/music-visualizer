import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// Pack identity is the SHA-256 over the deterministic record:
//
//   for each file in pack, sorted by POSIX relative path:
//     sha256(relPath) + ":" + sha256(content) + "\n"
//
// This is independent of filesystem traversal order and zip stream ordering,
// so re-importing the same `.viz` produces the same id, and a built-in's id
// only changes when its bytes change.

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

export function computePackHashFromDir(dir: string): string {
	const files: Array<{ relPath: string; fullPath: string }> = [];
	listFilesRecursive(dir, "", files);
	const records = files.map((f) => ({ relPath: f.relPath, bytes: readFileSync(f.fullPath) }));
	return combine(records);
}

export function computePackHashFromEntries(
	entries: Record<string, Uint8Array>,
	prefix: string,
): string {
	const records: Array<{ relPath: string; bytes: Uint8Array }> = [];
	for (const [path, bytes] of Object.entries(entries)) {
		if (path.endsWith("/")) continue;
		if (prefix && !path.startsWith(prefix)) continue;
		const rel = path.slice(prefix.length).replace(/\\/g, "/");
		if (!rel) continue;
		records.push({ relPath: rel, bytes });
	}
	return combine(records);
}

const HEX64_RE = /^[0-9a-f]{64}$/;
export function isPackHash(s: string): boolean {
	return HEX64_RE.test(s);
}

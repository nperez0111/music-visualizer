import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, resolve, basename } from "path";
import { parseArgs } from "util";
import { zipSync } from "fflate";
import { validateManifest } from "@catnip/shared/manifest";
import { PACK_LIMITS } from "@catnip/shared/limits";
import { computePackHash } from "@catnip/shared/hash";

function collectFiles(
	dir: string,
	prefix: string,
	out: Array<{ relPath: string; bytes: Uint8Array }>,
): void {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const rel = prefix ? `${prefix}/${name}` : name;
		const st = statSync(full);
		if (st.isDirectory()) {
			collectFiles(full, rel, out);
		} else if (st.isFile()) {
			out.push({ relPath: rel, bytes: new Uint8Array(readFileSync(full)) });
		}
	}
}

export async function run(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		options: {
			out: { type: "string", short: "o" },
			help: { type: "boolean", short: "h" },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log("catnip build — Zip a pack directory into a .viz archive\n");
		console.log("Usage: catnip build [path] [--out <file>]\n");
		console.log("Options:");
		console.log("  path         Pack directory (default: current directory)");
		console.log("  --out, -o    Output .viz path (default: <name>.viz)");
		return;
	}

	const packDir = resolve(positionals[0] ?? ".");

	// Validate manifest exists
	const manifestPath = join(packDir, "manifest.json");
	if (!existsSync(manifestPath)) {
		throw new Error(`No manifest.json found in ${packDir}`);
	}

	const rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	const result = validateManifest(rawManifest);
	if (!result.ok) {
		throw new Error(`Invalid manifest: ${result.err}`);
	}

	const manifest = result.m;

	// Check shader exists
	if (!existsSync(join(packDir, manifest.shader))) {
		throw new Error(`Shader file not found: ${manifest.shader}`);
	}

	// Check wasm exists if declared
	if (manifest.wasm && !existsSync(join(packDir, manifest.wasm))) {
		throw new Error(`WASM file not found: ${manifest.wasm}`);
	}

	// Check pass shaders exist
	for (const pass of manifest.passes ?? []) {
		if (!existsSync(join(packDir, pass.shader))) {
			throw new Error(`Pass shader file not found: ${pass.shader}`);
		}
	}

	// Check image files exist
	for (const img of manifest.images ?? []) {
		if (!existsSync(join(packDir, img.file))) {
			throw new Error(`Image file not found: ${img.file}`);
		}
	}

	// Collect all files
	const files: Array<{ relPath: string; bytes: Uint8Array }> = [];
	collectFiles(packDir, "", files);

	// Check limits
	if (files.length > PACK_LIMITS.MAX_ENTRY_COUNT) {
		throw new Error(`Too many files: ${files.length} (max ${PACK_LIMITS.MAX_ENTRY_COUNT})`);
	}

	let totalSize = 0;
	for (const f of files) {
		if (f.bytes.length > PACK_LIMITS.MAX_ENTRY_BYTES) {
			throw new Error(`File too large: ${f.relPath} (${f.bytes.length} bytes, max ${PACK_LIMITS.MAX_ENTRY_BYTES})`);
		}
		totalSize += f.bytes.length;
	}
	if (totalSize > PACK_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
		throw new Error(`Total uncompressed size too large: ${totalSize} bytes (max ${PACK_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES})`);
	}

	// Compute content hash
	const entries: Record<string, Uint8Array> = {};
	for (const f of files) {
		entries[f.relPath] = f.bytes;
	}
	const hash = computePackHash(entries, "");

	// Build zip
	const zipEntries: Record<string, Uint8Array> = {};
	for (const f of files) {
		zipEntries[f.relPath] = f.bytes;
	}
	const zipped = zipSync(zipEntries);

	if (zipped.length > PACK_LIMITS.MAX_ARCHIVE_BYTES) {
		throw new Error(`Compressed archive too large: ${zipped.length} bytes (max ${PACK_LIMITS.MAX_ARCHIVE_BYTES})`);
	}

	// Write output
	const slug = basename(packDir);
	const dest = values.out ?? `${slug}.viz`;
	await Bun.write(dest, zipped);

	console.log(`${manifest.name} v${manifest.version}`);
	console.log(`  hash: ${hash}`);
	console.log(`  size: ${zipped.length} bytes (${files.length} files)`);
	console.log(`  wrote: ${dest}`);
}

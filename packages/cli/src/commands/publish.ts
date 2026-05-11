import { readFileSync, existsSync } from "fs";
import { join, resolve, basename } from "path";
import { parseArgs } from "util";
import { zipSync } from "fflate";
import type {} from "@atcute/atproto";
import { validateManifest } from "@catnip/shared/manifest";
import { computePackHash } from "@catnip/shared/hash";
import { PACK_LIMITS } from "@catnip/shared/limits";
import { requireSession, getAuthenticatedClient } from "../lib/auth.ts";

function collectFiles(
	dir: string,
	prefix: string,
	out: Array<{ relPath: string; bytes: Uint8Array }>,
): void {
	const { readdirSync, lstatSync } = require("fs") as typeof import("fs");
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const rel = prefix ? `${prefix}/${name}` : name;
		const st = lstatSync(full);
		// Skip symlinks to prevent exfiltration of arbitrary files
		if (st.isSymbolicLink()) continue;
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
			slug: { type: "string", short: "s" },
			changelog: { type: "string", short: "c" },
			help: { type: "boolean", short: "h" },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log("catnip publish — Publish a pack to the AT Protocol network\n");
		console.log("Usage: catnip publish [path] [options]\n");
		console.log("Options:");
		console.log("  path               Pack directory (default: current directory)");
		console.log("  --slug, -s <slug>  Release slug/rkey (default: directory name)");
		console.log("  --changelog, -c    Changelog for this version");
		console.log("\nRequires `catnip login` first.");
		return;
	}

	const session = requireSession();
	const packDir = resolve(positionals[0] ?? ".");

	// Validate manifest
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

	// Check referenced files
	if (!existsSync(join(packDir, manifest.shader))) {
		throw new Error(`Shader file not found: ${manifest.shader}`);
	}
	if (manifest.wasm && !existsSync(join(packDir, manifest.wasm))) {
		throw new Error(`WASM file not found: ${manifest.wasm}`);
	}
	for (const pass of manifest.passes ?? []) {
		if (!existsSync(join(packDir, pass.shader))) {
			throw new Error(`Pass shader file not found: ${pass.shader}`);
		}
	}
	for (const img of manifest.images ?? []) {
		if (!existsSync(join(packDir, img.file))) {
			throw new Error(`Image file not found: ${img.file}`);
		}
	}

	// Build .viz archive in memory
	const files: Array<{ relPath: string; bytes: Uint8Array }> = [];
	collectFiles(packDir, "", files);

	if (files.length > PACK_LIMITS.MAX_ENTRY_COUNT) {
		throw new Error(`Too many files: ${files.length} (max ${PACK_LIMITS.MAX_ENTRY_COUNT})`);
	}

	let totalSize = 0;
	for (const f of files) {
		if (f.bytes.length > PACK_LIMITS.MAX_ENTRY_BYTES) {
			throw new Error(`File too large: ${f.relPath}`);
		}
		totalSize += f.bytes.length;
	}
	if (totalSize > PACK_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
		throw new Error(`Total uncompressed size too large: ${totalSize} bytes`);
	}

	// Compute hash
	const entries: Record<string, Uint8Array> = {};
	for (const f of files) {
		entries[f.relPath] = f.bytes;
	}
	const hash = computePackHash(entries, "");

	// Zip
	const zipEntries: Record<string, Uint8Array> = {};
	for (const f of files) {
		zipEntries[f.relPath] = f.bytes;
	}
	const vizBytes = zipSync(zipEntries);

	if (vizBytes.length > PACK_LIMITS.MAX_ARCHIVE_BYTES) {
		throw new Error(`Compressed archive too large: ${vizBytes.length} bytes`);
	}

	const slug = values.slug ?? basename(packDir);

	console.log(`Publishing ${manifest.name} v${manifest.version} as ${slug}...`);
	console.log(`  hash: ${hash}`);
	console.log(`  size: ${vizBytes.length} bytes`);

	// Get authenticated client (restores OAuth session, auto-refreshes tokens)
	const client = await getAuthenticatedClient();

	// Upload .viz blob
	console.log("Uploading .viz blob...");
	const { data: blobResult } = await client.post("com.atproto.repo.uploadBlob", {
		input: new Blob([vizBytes], { type: "application/zip" }),
	});

	// Create or update the release record (rkey = slug)
	console.log("Creating release record...");
	const now = new Date().toISOString();

	// Extract tags from manifest if available
	const releaseRecord: Record<string, unknown> = {
		$type: "com.nickthesick.catnip.release",
		name: manifest.name,
		slug,
		description: manifest.description ?? "",
		createdAt: now,
	};
	if (manifest.tags && manifest.tags.length > 0) {
		releaseRecord.tags = manifest.tags.slice(0, 10);
	}

	await client.post("com.atproto.repo.putRecord", {
		input: {
			repo: session.did,
			collection: "com.nickthesick.catnip.release",
			rkey: slug,
			record: releaseRecord,
		},
	});

	// Create the version record (rkey = slug:version)
	console.log("Creating version record...");
	const releaseUri = `at://${session.did}/com.nickthesick.catnip.release/${slug}`;
	const versionRkey = `${slug}:${manifest.version}`;

	const versionRecord: Record<string, unknown> = {
		$type: "com.nickthesick.catnip.pack",
		release: releaseUri,
		version: manifest.version,
		viz: blobResult.blob,
		createdAt: now,
	};

	if (values.changelog) {
		versionRecord.changelog = values.changelog;
	}

	// Use putRecord with explicit rkey (slug:version) — immutable, will fail
	// if this version was already published (desired behaviour)
	const { data: createResult } = await client.post("com.atproto.repo.putRecord", {
		input: {
			repo: session.did,
			collection: "com.nickthesick.catnip.pack",
			rkey: versionRkey,
			record: versionRecord,
		},
	});

	console.log(`\nPublished ${manifest.name} v${manifest.version}`);
	console.log(`  release: ${releaseUri}`);
	console.log(`  version: ${createResult.uri}`);
}

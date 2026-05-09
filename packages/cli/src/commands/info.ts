import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { parseArgs } from "util";
import { unzipSync } from "fflate";
import { validateManifest } from "@catnip/shared/manifest";
import { computePackHash, computePackHashFromDir } from "@catnip/shared/hash";
import type { PackManifest } from "@catnip/shared/types";

function printManifest(m: PackManifest, hash: string): void {
	console.log(`${m.name} v${m.version}`);
	if (m.author) console.log(`  author:      ${m.author}`);
	if (m.description) console.log(`  description: ${m.description}`);
	console.log(`  hash:        ${hash}`);
	console.log(`  shader:      ${m.shader}`);
	if (m.wasm) console.log(`  wasm:        ${m.wasm} (Tier 2)`);
	if (m.parameters?.length) {
		console.log(`  parameters:  ${m.parameters.length}`);
		for (const p of m.parameters) {
			const label = p.label ? ` "${p.label}"` : "";
			console.log(`    - ${p.name}${label} (${p.type})`);
		}
	}
	if (m.presets?.length) {
		console.log(`  presets:     ${m.presets.length}`);
		for (const p of m.presets) {
			console.log(`    - ${p.name}`);
		}
	}
	if (m.passes?.length) {
		console.log(`  passes:      ${m.passes.length}`);
		for (const p of m.passes) {
			console.log(`    - ${p.shader}`);
		}
	}
	if (m.images?.length) {
		console.log(`  images:      ${m.images.length}`);
		for (const img of m.images) {
			console.log(`    - ${img.name}: ${img.file}`);
		}
	}
	if (m.audio?.features?.length) {
		console.log(`  audio:       ${m.audio.features.join(", ")}`);
	}
	if (m.tags?.length) {
		console.log(`  tags:        ${m.tags.join(", ")}`);
	}
}

export async function run(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		options: {
			help: { type: "boolean", short: "h" },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log("catnip info — Display pack metadata\n");
		console.log("Usage: catnip info <path>\n");
		console.log("  path    A .viz file or pack directory");
		return;
	}

	const target = resolve(positionals[0] ?? ".");

	if (target.endsWith(".viz") || target.endsWith(".zip")) {
		// Read as archive
		if (!existsSync(target)) {
			throw new Error(`File not found: ${target}`);
		}
		const archiveBytes = new Uint8Array(readFileSync(target));
		const entries = unzipSync(archiveBytes);

		// Find manifest.json (root or one level deep)
		let manifestKey: string | undefined;
		let prefix = "";
		for (const key of Object.keys(entries)) {
			if (key === "manifest.json" || key.endsWith("/manifest.json")) {
				const parts = key.split("/");
				if (parts.length <= 2) {
					manifestKey = key;
					prefix = parts.length === 2 ? parts[0] + "/" : "";
					break;
				}
			}
		}

		if (!manifestKey) {
			throw new Error("No manifest.json found in archive");
		}

		const rawManifest = JSON.parse(new TextDecoder().decode(entries[manifestKey]));
		const result = validateManifest(rawManifest);
		if (!result.ok) {
			throw new Error(`Invalid manifest: ${result.err}`);
		}

		const hash = computePackHash(entries, prefix);
		printManifest(result.m, hash);
	} else {
		// Read as directory
		const manifestPath = join(target, "manifest.json");
		if (!existsSync(manifestPath)) {
			throw new Error(`No manifest.json found in ${target}`);
		}

		const rawManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		const result = validateManifest(rawManifest);
		if (!result.ok) {
			throw new Error(`Invalid manifest: ${result.err}`);
		}

		const hash = computePackHashFromDir(target);
		printManifest(result.m, hash);
	}
}

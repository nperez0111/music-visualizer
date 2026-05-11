import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { parseArgs } from "util";
import { validateManifest } from "@catnip/shared/manifest";

export async function run(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		options: {
			help: { type: "boolean", short: "h" },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log("catnip validate — Check manifest + compile shader\n");
		console.log("Usage: catnip validate [path]\n");
		console.log("  path    Pack directory (default: current directory)");
		return;
	}

	const packDir = resolve(positionals[0] ?? ".");

	const manifestPath = join(packDir, "manifest.json");
	if (!existsSync(manifestPath)) {
		throw new Error(`No manifest.json found in ${packDir}`);
	}

	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		throw new Error("manifest.json is not valid JSON");
	}

	const result = validateManifest(raw);
	if (!result.ok) {
		throw new Error(`Manifest validation failed: ${result.err}`);
	}

	const m = result.m;

	// Check referenced files exist
	const missing: string[] = [];

	if (!existsSync(join(packDir, m.shader))) {
		missing.push(m.shader);
	}
	if (m.wasm && !existsSync(join(packDir, m.wasm))) {
		missing.push(m.wasm);
	}
	for (const pass of m.passes ?? []) {
		if (!existsSync(join(packDir, pass.shader))) {
			missing.push(pass.shader);
		}
	}
	for (const img of m.images ?? []) {
		if (!existsSync(join(packDir, img.file))) {
			missing.push(img.file);
		}
	}

	if (missing.length > 0) {
		throw new Error(`Missing files: ${missing.join(", ")}`);
	}

	console.log(`${m.name} v${m.version} — valid`);

	// Summary
	const parts: string[] = [];
	parts.push(m.shader.endsWith(".glsl") ? "GLSL" : "WGSL");
	if (m.wasm) parts.push("Tier 2 (WASM)");
	if (m.parameters?.length) parts.push(`${m.parameters.length} params`);
	if (m.presets?.length) parts.push(`${m.presets.length} presets`);
	if (m.passes?.length) parts.push(`${m.passes.length} post-FX passes`);
	if (m.images?.length) parts.push(`${m.images.length} images`);
	if (m.audio?.features?.length) parts.push(`audio: ${m.audio.features.join(", ")}`);
	if (m.tags?.length) parts.push(`tags: ${m.tags.join(", ")}`);

	console.log(`  ${parts.join(" | ")}`);
}

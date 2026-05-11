import { existsSync } from "fs";
import { resolve } from "path";
import { parseArgs } from "util";
import { spawnSync } from "child_process";

export async function run(args: string[]): Promise<void> {
	const { values, positionals } = parseArgs({
		args,
		options: {
			out: { type: "string", short: "o" },
			width: { type: "string" },
			height: { type: "string" },
			frames: { type: "string" },
			time: { type: "string" },
			webp: { type: "boolean" },
			"webp-frames": { type: "string" },
			"webp-duration": { type: "string" },
			"webp-quality": { type: "string" },
			param: { type: "string", multiple: true },
			preset: { type: "string" },
			audio: { type: "string", multiple: true },
			help: { type: "boolean", short: "h" },
		},
		allowPositionals: true,
	});

	if (values.help) {
		console.log("catnip preview — Headless render to PNG or animated WebP\n");
		console.log("Usage: catnip preview <pack-dir-or-slug> [options]\n");
		console.log("Options:");
		console.log("  --out, -o <path>       Output path (default: /tmp/<slug>.png)");
		console.log("  --width <n>            Image width (default 640)");
		console.log("  --height <n>           Image height (default 480)");
		console.log("  --frames <n>           Total frames to simulate (default 120)");
		console.log("  --time <seconds>       Capture at a specific simulated time");
		console.log("  --webp                 Output animated WebP instead of PNG");
		console.log("  --webp-frames <n>      Frames for WebP animation (default 20)");
		console.log("  --webp-duration <ms>   Duration per WebP frame (default 100)");
		console.log("  --webp-quality <n>     WebP quality 0-100 (default 80)");
		console.log("  --param <name>=<val>   Override a parameter (repeatable)");
		console.log("  --preset <name>        Apply a named preset");
		console.log("  --audio <key>=<val>    Override audio features (repeatable)");
		console.log("\nDelegates to the headless renderer (scripts/render-pack-debug.ts).");
		console.log("Requires an Electrobun dev build (bun run dev) for wgpu-native.");
		return;
	}

	const target = positionals[0];
	if (!target) {
		throw new Error("Pack directory or slug is required. Usage: catnip preview <pack>");
	}

	// Find the render-pack-debug.ts script
	// Walk up from this file to find the repo root
	const repoRoot = findRepoRoot();
	const scriptPath = resolve(repoRoot, "scripts/render-pack-debug.ts");
	if (!existsSync(scriptPath)) {
		throw new Error(
			`Render script not found at ${scriptPath}. Make sure you're running from the Cat Nip repo.`,
		);
	}

	// Build args for render-pack-debug.ts
	const renderArgs: string[] = [scriptPath, target];

	if (values.out) renderArgs.push("--out", values.out);
	if (values.width) renderArgs.push("--width", values.width);
	if (values.height) renderArgs.push("--height", values.height);
	if (values.frames) renderArgs.push("--frames", values.frames);
	if (values.time) renderArgs.push("--time", values.time);
	if (values.webp) renderArgs.push("--webp");
	if (values["webp-frames"]) renderArgs.push("--webp-frames", values["webp-frames"]);
	if (values["webp-duration"]) renderArgs.push("--webp-duration", values["webp-duration"]);
	if (values["webp-quality"]) renderArgs.push("--webp-quality", values["webp-quality"]);
	if (values.preset) renderArgs.push("--preset", values.preset);

	for (const p of values.param ?? []) {
		renderArgs.push("--param", p);
	}
	for (const a of values.audio ?? []) {
		renderArgs.push("--audio", a);
	}

	const result = spawnSync("bun", renderArgs, {
		stdio: "inherit",
		cwd: repoRoot,
	});

	if (result.error) {
		throw new Error(`Failed to spawn renderer: ${result.error.message}`);
	}

	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function findRepoRoot(): string {
	let dir = resolve(import.meta.dir, "..");
	for (let i = 0; i < 10; i++) {
		if (existsSync(resolve(dir, "package.json"))) {
			// Check if this is the repo root (has scripts/ dir)
			if (existsSync(resolve(dir, "scripts/render-pack-debug.ts"))) {
				return dir;
			}
		}
		const parent = resolve(dir, "..");
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error("Could not find repo root. Run from within the Cat Nip repository.");
}

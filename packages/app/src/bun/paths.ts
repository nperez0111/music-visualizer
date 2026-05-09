import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

// Centralized filesystem layout. APP_DATA_DIR is currently macOS-only; when
// Windows/Linux land the per-platform branches live here so the rest of the
// codebase keeps using the same accessors.

const BUNDLE_ID = "cat-nip.nickthesick.com";

/** Per-user data directory (DB + extracted user packs). */
export const APP_DATA_DIR = join(
	homedir(),
	"Library",
	"Application Support",
	BUNDLE_ID,
);

/** Per-user packs directory; sub-directories are individual installed packs. */
export const USER_PACKS_DIR = join(APP_DATA_DIR, "packs");

/** SQLite database for preferences and (eventually) pack metadata. */
export const DB_PATH = join(APP_DATA_DIR, "visualizer.db");

/**
 * Resolve the audiocap helper binary. Production lives next to the bundle
 * resources; dev runs from the repo. Returns null if no candidate exists.
 */
export function findAudiocapBinary(): string | null {
	const candidates = [
		resolve(process.cwd(), "..", "Resources", "app", "audiocap"),
		resolve(import.meta.dir, "..", "audiocap"),
		resolve(process.cwd(), "src", "native", "audiocap", "audiocap"),
	];
	for (const path of candidates) {
		if (existsSync(path)) return path;
	}
	return null;
}

/**
 * Resolve the built-in packs directory. Production: bundle resources. Dev:
 * either the build output or the source tree.
 */
export function findBuiltinPacksDir(): string | null {
	const candidates = [
		resolve(process.cwd(), "..", "Resources", "app", "packs"),
		resolve(import.meta.dir, "..", "..", "packs"),
		resolve(process.cwd(), "src", "packs"),
	];
	for (const c of candidates) if (existsSync(c)) return c;
	return null;
}

/**
 * Resolve the naga-cli binary for GLSL → WGSL transpilation.
 * Production: bundled next to the app resources.
 * Dev: cargo-installed in ~/.cargo/bin or on PATH.
 */
export function findNagaBinary(): string | null {
	const candidates = [
		resolve(process.cwd(), "..", "Resources", "app", "naga"),
		resolve(homedir(), ".cargo", "bin", "naga"),
	];
	for (const path of candidates) {
		if (existsSync(path)) return path;
	}
	// Fall back to PATH lookup — check if `naga` is accessible
	try {
		const { spawnSync } = require("child_process");
		const result = spawnSync("which", ["naga"], { encoding: "utf8", timeout: 2000 });
		if (result.status === 0 && result.stdout.trim()) {
			return result.stdout.trim();
		}
	} catch {
		// Ignore
	}
	return null;
}

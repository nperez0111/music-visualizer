import { existsSync } from "fs";
import { homedir } from "os";
import { join, resolve } from "path";

// Centralized filesystem layout. Today this is macOS-only; when cross-platform
// audio lands the per-platform branches live here so the rest of the codebase
// keeps using the same accessors.

const BUNDLE_ID = "music-visualizer.electrobun.dev";

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
 * Resolve the audiotap helper binary. Production lives next to the bundle
 * resources; dev runs from the repo. Returns null if no candidate exists.
 */
export function findAudiotapBinary(): string | null {
	const candidates = [
		resolve(process.cwd(), "..", "Resources", "app", "audiotap"),
		resolve(import.meta.dir, "..", "audiotap"),
		resolve(process.cwd(), "src", "native", "audiotap", "audiotap"),
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

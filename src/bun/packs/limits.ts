// Marketplace-safety caps. Centralized so import.ts, loader.ts, and
// runtime.ts use the same numbers and they're easy to revisit.

export const PACK_LIMITS = {
	/** Maximum compressed size of a `.viz` archive accepted at import. */
	MAX_ARCHIVE_BYTES: 16 * 1024 * 1024,
	/** Maximum total decompressed size of all entries in a `.viz`. */
	MAX_TOTAL_UNCOMPRESSED_BYTES: 64 * 1024 * 1024,
	/** Maximum decompressed size of any single entry. */
	MAX_ENTRY_BYTES: 16 * 1024 * 1024,
	/** Maximum number of entries in a `.viz` archive. */
	MAX_ENTRY_COUNT: 64,
	/** Hard cap on a WASM pack's linear memory (pages of 64 KiB). 64 MiB. */
	MAX_WASM_MEMORY_PAGES: 1024,
	/** Bytes the pack-uniform region can hold (16384 buffer - 176 host header). */
	MAX_PACK_UNIFORM_BYTES: 16208,
	/**
	 * Frames the host will tolerate without a viz_frame response before
	 * terminating the worker and marking the pack runtimeBroken.
	 */
	WASM_FRAME_DEADLINE_FRAMES: 2,
} as const;

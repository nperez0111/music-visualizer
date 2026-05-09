/**
 * Simple in-memory sliding-window rate limiter.
 * Tracks request timestamps per key (typically DID or IP).
 */

type Window = { timestamps: number[] };

export class RateLimiter {
	private windows = new Map<string, Window>();
	private readonly maxRequests: number;
	private readonly windowMs: number;

	constructor(opts: { maxRequests: number; windowMs: number }) {
		this.maxRequests = opts.maxRequests;
		this.windowMs = opts.windowMs;
	}

	/**
	 * Check if the key is allowed to make a request.
	 * Returns true if allowed, false if rate-limited.
	 */
	check(key: string): boolean {
		const now = Date.now();
		const cutoff = now - this.windowMs;

		let win = this.windows.get(key);
		if (!win) {
			win = { timestamps: [] };
			this.windows.set(key, win);
		}

		// Prune old timestamps
		win.timestamps = win.timestamps.filter((t) => t > cutoff);

		if (win.timestamps.length >= this.maxRequests) {
			return false;
		}

		win.timestamps.push(now);
		return true;
	}

	/**
	 * Get remaining requests for a key in the current window.
	 */
	remaining(key: string): number {
		const now = Date.now();
		const cutoff = now - this.windowMs;
		const win = this.windows.get(key);
		if (!win) return this.maxRequests;
		const active = win.timestamps.filter((t) => t > cutoff).length;
		return Math.max(0, this.maxRequests - active);
	}

	/**
	 * Periodic cleanup of stale entries to prevent memory leaks.
	 */
	cleanup(): void {
		const now = Date.now();
		const cutoff = now - this.windowMs;
		for (const [key, win] of this.windows) {
			win.timestamps = win.timestamps.filter((t) => t > cutoff);
			if (win.timestamps.length === 0) {
				this.windows.delete(key);
			}
		}
	}
}

// Pre-configured limiters for different endpoints

/** Publish: 10 publishes per hour per DID */
export const publishLimiter = new RateLimiter({ maxRequests: 10, windowMs: 60 * 60 * 1000 });

/** Star/unstar: 60 actions per minute per DID */
export const starLimiter = new RateLimiter({ maxRequests: 60, windowMs: 60 * 1000 });

/** Download: 100 downloads per minute per IP */
export const downloadLimiter = new RateLimiter({ maxRequests: 100, windowMs: 60 * 1000 });

/** Indexer: 20 pack versions per hour per DID (ingestion defence) */
export const indexerVersionLimiter = new RateLimiter({ maxRequests: 20, windowMs: 60 * 60 * 1000 });

// Cleanup stale entries every 5 minutes
setInterval(() => {
	publishLimiter.cleanup();
	starLimiter.cleanup();
	downloadLimiter.cleanup();
	indexerVersionLimiter.cleanup();
}, 5 * 60 * 1000).unref();

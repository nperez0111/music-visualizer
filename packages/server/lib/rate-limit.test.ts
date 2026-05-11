import { describe, test, expect } from "bun:test";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
	test("allows requests within limit", () => {
		const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });
		expect(limiter.check("key1")).toBe(true);
		expect(limiter.check("key1")).toBe(true);
		expect(limiter.check("key1")).toBe(true);
	});

	test("blocks requests over limit", () => {
		const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });
		expect(limiter.check("key1")).toBe(true);
		expect(limiter.check("key1")).toBe(true);
		expect(limiter.check("key1")).toBe(false); // Over limit
	});

	test("tracks keys independently", () => {
		const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });
		expect(limiter.check("did:plc:alice")).toBe(true);
		expect(limiter.check("did:plc:bob")).toBe(true);
		// Alice is blocked, Bob still has one
		expect(limiter.check("did:plc:alice")).toBe(false);
		expect(limiter.check("did:plc:bob")).toBe(false);
	});

	test("remaining returns correct count", () => {
		const limiter = new RateLimiter({ maxRequests: 5, windowMs: 60_000 });
		expect(limiter.remaining("key1")).toBe(5);
		limiter.check("key1");
		expect(limiter.remaining("key1")).toBe(4);
		limiter.check("key1");
		limiter.check("key1");
		expect(limiter.remaining("key1")).toBe(2);
	});

	test("cleanup removes stale entries", () => {
		const limiter = new RateLimiter({ maxRequests: 10, windowMs: 1 }); // 1ms window
		limiter.check("key1");

		// Wait for window to expire (timestamps will be stale)
		const start = Date.now();
		while (Date.now() - start < 5) {} // busy-wait 5ms

		limiter.cleanup();
		// After cleanup, key should have full remaining since timestamps expired
		expect(limiter.remaining("key1")).toBe(10);
	});

	test("indexer rate limit: 20 per hour per DID", () => {
		const limiter = new RateLimiter({ maxRequests: 20, windowMs: 60 * 60 * 1000 });
		for (let i = 0; i < 20; i++) {
			expect(limiter.check("did:plc:spammer")).toBe(true);
		}
		// 21st should be blocked
		expect(limiter.check("did:plc:spammer")).toBe(false);
		// Other DIDs unaffected
		expect(limiter.check("did:plc:legit")).toBe(true);
	});
});

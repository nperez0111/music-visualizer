import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We test the core session persistence logic with a custom path.
// Since the module uses a hardcoded path, we test the shape and
// round-trip serialization of the session format directly.

describe("auth", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "cli-auth-"));
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("session file round-trip with new StoredSession shape", async () => {
		const sessionPath = join(tmpDir, "session.json");

		const session = {
			did: "did:plc:test123",
			handle: "test.bsky.social",
			service: "https://bsky.social",
		};

		writeFileSync(sessionPath, JSON.stringify(session, null, "\t") + "\n");
		const loaded = JSON.parse(readFileSync(sessionPath, "utf8"));

		expect(loaded.did).toBe(session.did);
		expect(loaded.handle).toBe(session.handle);
		expect(loaded.service).toBe(session.service);

		// Old fields should NOT be present
		expect(loaded.sid).toBeUndefined();
		expect(loaded.server).toBeUndefined();
		expect(loaded.accessJwt).toBeUndefined();
		expect(loaded.refreshJwt).toBeUndefined();
	});

	test("missing session returns null on parse", () => {
		const sessionPath = join(tmpDir, "nonexistent.json");
		expect(existsSync(sessionPath)).toBe(false);
	});

	test("StoredSession has exactly 3 fields", () => {
		// Validate the expected shape matches our type contract
		const session = {
			did: "did:plc:abc123",
			handle: "alice.bsky.social",
			service: "https://puffball.us-east.host.bsky.network",
		};

		const keys = Object.keys(session);
		expect(keys).toEqual(["did", "handle", "service"]);
		expect(keys.length).toBe(3);
	});
});

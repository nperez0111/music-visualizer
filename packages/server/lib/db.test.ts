import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
	upsertRelease,
	upsertVersion,
	upsertStar,
	deleteRelease,
	deleteVersion,
	deleteStar,
	setVersionPreview,
	setVersionTags,
	getCursor,
	setCursor,
	type ReleaseRow,
	type VersionRow,
	type StarRow,
} from "./db";

let db: Database;

function migrate(database: Database): void {
	database.exec(`
		CREATE TABLE IF NOT EXISTS releases (
			did         TEXT NOT NULL,
			rkey        TEXT NOT NULL,
			name        TEXT NOT NULL,
			slug        TEXT NOT NULL,
			description TEXT,
			created_at  TEXT NOT NULL,
			indexed_at  TEXT NOT NULL DEFAULT (datetime('now')),
			hidden      INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (did, rkey)
		);
		CREATE TABLE IF NOT EXISTS versions (
			did          TEXT NOT NULL,
			rkey         TEXT NOT NULL,
			release_did  TEXT NOT NULL,
			release_rkey TEXT NOT NULL,
			version      TEXT NOT NULL,
			viz_cid      TEXT NOT NULL,
			changelog    TEXT,
			preview_path TEXT,
			created_at   TEXT NOT NULL,
			indexed_at   TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (did, rkey),
			FOREIGN KEY (release_did, release_rkey) REFERENCES releases(did, rkey)
		);
		CREATE TABLE IF NOT EXISTS stars (
			did         TEXT NOT NULL,
			rkey        TEXT NOT NULL,
			subject_uri TEXT NOT NULL,
			created_at  TEXT NOT NULL,
			indexed_at  TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (did, rkey)
		);
		CREATE TABLE IF NOT EXISTS tags (
			version_did  TEXT NOT NULL,
			version_rkey TEXT NOT NULL,
			tag          TEXT NOT NULL,
			FOREIGN KEY (version_did, version_rkey) REFERENCES versions(did, rkey)
		);
		CREATE INDEX IF NOT EXISTS idx_versions_release ON versions(release_did, release_rkey);
		CREATE INDEX IF NOT EXISTS idx_stars_subject ON stars(subject_uri);
		CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
		CREATE TABLE IF NOT EXISTS cursor (
			id     INTEGER PRIMARY KEY CHECK (id = 1),
			cursor INTEGER NOT NULL DEFAULT 0
		);
		INSERT OR IGNORE INTO cursor (id, cursor) VALUES (1, 0);
	`);
}

beforeEach(() => {
	db = new Database(":memory:");
	db.exec("PRAGMA foreign_keys = ON");
	migrate(db);
});

const DID = "did:plc:test123";
const NOW = "2025-05-04T00:00:00Z";

describe("releases", () => {
	test("upsert inserts a new release", () => {
		upsertRelease(db, {
			did: DID,
			rkey: "my-pack",
			name: "My Pack",
			slug: "my-pack",
			description: "A test pack",
			created_at: NOW,
		});

		const row = db.prepare("SELECT * FROM releases WHERE did = ? AND rkey = ?").get(DID, "my-pack") as ReleaseRow;
		expect(row.name).toBe("My Pack");
		expect(row.slug).toBe("my-pack");
		expect(row.description).toBe("A test pack");
	});

	test("upsert updates an existing release", () => {
		upsertRelease(db, {
			did: DID,
			rkey: "my-pack",
			name: "My Pack",
			slug: "my-pack",
			created_at: NOW,
		});
		upsertRelease(db, {
			did: DID,
			rkey: "my-pack",
			name: "My Pack V2",
			slug: "my-pack",
			description: "Updated",
			created_at: NOW,
		});

		const rows = db.prepare("SELECT * FROM releases WHERE did = ?").all(DID) as ReleaseRow[];
		expect(rows.length).toBe(1);
		expect(rows[0].name).toBe("My Pack V2");
		expect(rows[0].description).toBe("Updated");
	});

	test("delete removes a release", () => {
		upsertRelease(db, { did: DID, rkey: "x", name: "X", slug: "x", created_at: NOW });
		deleteRelease(db, DID, "x");

		const row = db.prepare("SELECT * FROM releases WHERE did = ? AND rkey = ?").get(DID, "x");
		expect(row).toBeNull();
	});
});

describe("versions", () => {
	test("upsert inserts a new version (slug:version rkey)", () => {
		upsertRelease(db, { did: DID, rkey: "my-pack", name: "My Pack", slug: "my-pack", created_at: NOW });
		upsertVersion(db, {
			did: DID,
			rkey: "my-pack:1.0.0",
			release_did: DID,
			release_rkey: "my-pack",
			version: "1.0.0",
			viz_cid: "bafkrei_abc",
			changelog: "Initial release",
			created_at: NOW,
		});

		const row = db.prepare("SELECT * FROM versions WHERE did = ? AND rkey = ?").get(DID, "my-pack:1.0.0") as VersionRow;
		expect(row.version).toBe("1.0.0");
		expect(row.viz_cid).toBe("bafkrei_abc");
		expect(row.changelog).toBe("Initial release");
		expect(row.rkey).toBe("my-pack:1.0.0");
	});

	test("upsert updates CID on duplicate version (refresh)", () => {
		upsertRelease(db, { did: DID, rkey: "my-pack", name: "My Pack", slug: "my-pack", created_at: NOW });
		upsertVersion(db, {
			did: DID,
			rkey: "my-pack:1.0.0",
			release_did: DID,
			release_rkey: "my-pack",
			version: "1.0.0",
			viz_cid: "cid1",
			created_at: NOW,
		});
		// Try to insert again with different CID — should update (refresh from PDS)
		upsertVersion(db, {
			did: DID,
			rkey: "my-pack:1.0.0",
			release_did: DID,
			release_rkey: "my-pack",
			version: "1.0.0",
			viz_cid: "cid2",
			created_at: NOW,
		});

		const row = db.prepare("SELECT * FROM versions WHERE did = ? AND rkey = ?").get(DID, "my-pack:1.0.0") as VersionRow;
		expect(row.viz_cid).toBe("cid2"); // Updated to latest CID
	});

	test("multiple versions of same pack use slug:version rkeys", () => {
		upsertRelease(db, { did: DID, rkey: "my-pack", name: "My Pack", slug: "my-pack", created_at: NOW });
		upsertVersion(db, {
			did: DID,
			rkey: "my-pack:1.0.0",
			release_did: DID,
			release_rkey: "my-pack",
			version: "1.0.0",
			viz_cid: "cid1",
			created_at: NOW,
		});
		upsertVersion(db, {
			did: DID,
			rkey: "my-pack:1.1.0",
			release_did: DID,
			release_rkey: "my-pack",
			version: "1.1.0",
			viz_cid: "cid2",
			created_at: "2025-05-05T00:00:00Z",
		});

		const rows = db
			.prepare("SELECT * FROM versions WHERE release_did = ? AND release_rkey = ? ORDER BY created_at DESC")
			.all(DID, "my-pack") as VersionRow[];
		expect(rows.length).toBe(2);
		expect(rows[0].rkey).toBe("my-pack:1.1.0");
		expect(rows[1].rkey).toBe("my-pack:1.0.0");
	});

	test("delete removes a version and its tags", () => {
		upsertRelease(db, { did: DID, rkey: "my-pack", name: "My Pack", slug: "my-pack", created_at: NOW });
		upsertVersion(db, {
			did: DID,
			rkey: "my-pack:1.0.0",
			release_did: DID,
			release_rkey: "my-pack",
			version: "1.0.0",
			viz_cid: "cid1",
			created_at: NOW,
		});
		setVersionTags(db, DID, "my-pack:1.0.0", ["fractal", "3d"]);
		deleteVersion(db, DID, "my-pack:1.0.0");

		const version = db.prepare("SELECT * FROM versions WHERE did = ? AND rkey = ?").get(DID, "my-pack:1.0.0");
		expect(version).toBeNull();

		const tags = db.prepare("SELECT * FROM tags WHERE version_did = ? AND version_rkey = ?").all(DID, "my-pack:1.0.0");
		expect(tags.length).toBe(0);
	});

	test("setVersionPreview updates preview path", () => {
		upsertRelease(db, { did: DID, rkey: "my-pack", name: "My Pack", slug: "my-pack", created_at: NOW });
		upsertVersion(db, {
			did: DID,
			rkey: "my-pack:1.0.0",
			release_did: DID,
			release_rkey: "my-pack",
			version: "1.0.0",
			viz_cid: "cid1",
			created_at: NOW,
		});
		setVersionPreview(db, DID, "my-pack:1.0.0", "/data/previews/abc.webp");

		const row = db.prepare("SELECT preview_path FROM versions WHERE did = ? AND rkey = ?").get(DID, "my-pack:1.0.0") as VersionRow;
		expect(row.preview_path).toBe("/data/previews/abc.webp");
	});
});

describe("stars", () => {
	test("upsert inserts a star", () => {
		const uri = `at://${DID}/com.nickthesick.catnip.release/my-pack`;
		upsertStar(db, {
			did: "did:plc:voter",
			rkey: "tid-star-1",
			subject_uri: uri,
			created_at: NOW,
		});

		const row = db.prepare("SELECT * FROM stars WHERE did = ?").get("did:plc:voter") as StarRow;
		expect(row.subject_uri).toBe(uri);
	});

	test("upsert ignores duplicate star", () => {
		const uri = `at://${DID}/com.nickthesick.catnip.release/my-pack`;
		upsertStar(db, { did: "did:plc:voter", rkey: "tid1", subject_uri: uri, created_at: NOW });
		upsertStar(db, { did: "did:plc:voter", rkey: "tid1", subject_uri: "at://other", created_at: NOW });

		const row = db.prepare("SELECT * FROM stars WHERE did = ? AND rkey = ?").get("did:plc:voter", "tid1") as StarRow;
		expect(row.subject_uri).toBe(uri); // Original preserved
	});

	test("delete removes a star", () => {
		upsertStar(db, { did: "did:plc:voter", rkey: "tid1", subject_uri: "at://x", created_at: NOW });
		deleteStar(db, "did:plc:voter", "tid1");

		const row = db.prepare("SELECT * FROM stars WHERE did = ? AND rkey = ?").get("did:plc:voter", "tid1");
		expect(row).toBeNull();
	});
});

describe("tags", () => {
	test("setVersionTags replaces tags", () => {
		upsertRelease(db, { did: DID, rkey: "my-pack", name: "X", slug: "x", created_at: NOW });
		upsertVersion(db, {
			did: DID,
			rkey: "my-pack:1.0.0",
			release_did: DID,
			release_rkey: "my-pack",
			version: "1.0.0",
			viz_cid: "cid1",
			created_at: NOW,
		});

		setVersionTags(db, DID, "my-pack:1.0.0", ["fractal", "3d"]);
		let tags = db.prepare("SELECT tag FROM tags WHERE version_did = ? AND version_rkey = ?").all(DID, "my-pack:1.0.0") as { tag: string }[];
		expect(tags.map((t) => t.tag).sort()).toEqual(["3d", "fractal"]);

		// Replace
		setVersionTags(db, DID, "my-pack:1.0.0", ["retro"]);
		tags = db.prepare("SELECT tag FROM tags WHERE version_did = ? AND version_rkey = ?").all(DID, "my-pack:1.0.0") as { tag: string }[];
		expect(tags.map((t) => t.tag)).toEqual(["retro"]);
	});
});

describe("cursor", () => {
	test("initial cursor is 0", () => {
		expect(getCursor(db)).toBe(0);
	});

	test("setCursor updates the cursor", () => {
		setCursor(db, 12345);
		expect(getCursor(db)).toBe(12345);
	});

	test("setCursor can update multiple times", () => {
		setCursor(db, 100);
		setCursor(db, 200);
		expect(getCursor(db)).toBe(200);
	});
});

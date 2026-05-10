import { Database } from "bun:sqlite";
import { join } from "path";

let _db: Database | null = null;

export function getDb(): Database {
	if (_db) return _db;

	const dataDir = process.env.CATNIP_DATA_DIR ?? ".data";
	const dbPath = join(dataDir, "registry.db");

	// Ensure data directory exists
	const { mkdirSync } = require("fs");
	mkdirSync(dataDir, { recursive: true });

	_db = new Database(dbPath);
	_db.exec("PRAGMA journal_mode = WAL");
	_db.exec("PRAGMA foreign_keys = OFF");

	migrate(_db);
	return _db;
}

function migrate(db: Database): void {
	// Ensure schema_version table exists
	db.exec(`
		CREATE TABLE IF NOT EXISTS schema_version (
			version INTEGER NOT NULL DEFAULT 0
		);
		INSERT OR IGNORE INTO schema_version (rowid, version) VALUES (1, 0);
	`);

	const currentVersion = (db.prepare("SELECT version FROM schema_version WHERE rowid = 1").get() as { version: number }).version;

	// Run migrations sequentially
	const migrations: Array<(db: Database) => void> = [
		migrationV1,
	];

	for (let i = currentVersion; i < migrations.length; i++) {
		console.log(`[db] running migration ${i + 1}...`);
		db.exec("BEGIN");
		try {
			migrations[i](db);
			db.prepare("UPDATE schema_version SET version = ? WHERE rowid = 1").run(i + 1);
			db.exec("COMMIT");
			console.log(`[db] migration ${i + 1} complete`);
		} catch (err) {
			db.exec("ROLLBACK");
			throw err;
		}
	}
}

/** Migration 1: Create initial schema (or recreate tables without FK constraints) */
function migrationV1(db: Database): void {
	// If tables exist with FK constraints (from before migration system), recreate them.
	// If tables don't exist yet (fresh DB), just create them.

	const tableExists = (name: string) =>
		db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name) != null;

	// --- releases (no FK changes needed, just ensure it exists) ---
	db.exec(`
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
	`);

	// --- versions (remove FK constraint if present) ---
	if (tableExists("versions")) {
		// Check if the table has FK constraints by inspecting the SQL
		const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='versions'").get() as { sql: string } | null;
		if (info?.sql?.includes("FOREIGN KEY")) {
			db.exec(`
				ALTER TABLE versions RENAME TO _versions_old;
				CREATE TABLE versions (
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
					PRIMARY KEY (did, rkey)
				);
				INSERT INTO versions SELECT * FROM _versions_old;
				DROP TABLE _versions_old;
			`);
		}
	} else {
		db.exec(`
			CREATE TABLE versions (
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
				PRIMARY KEY (did, rkey)
			);
		`);
	}

	// --- stars ---
	db.exec(`
		CREATE TABLE IF NOT EXISTS stars (
			did         TEXT NOT NULL,
			rkey        TEXT NOT NULL,
			subject_uri TEXT NOT NULL,
			created_at  TEXT NOT NULL,
			indexed_at  TEXT NOT NULL DEFAULT (datetime('now')),
			PRIMARY KEY (did, rkey)
		);
	`);

	// --- tags (remove FK constraint if present) ---
	if (tableExists("tags")) {
		const info = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tags'").get() as { sql: string } | null;
		if (info?.sql?.includes("FOREIGN KEY")) {
			db.exec(`
				ALTER TABLE tags RENAME TO _tags_old;
				CREATE TABLE tags (
					version_did  TEXT NOT NULL,
					version_rkey TEXT NOT NULL,
					tag          TEXT NOT NULL
				);
				INSERT INTO tags SELECT * FROM _tags_old;
				DROP TABLE _tags_old;
			`);
		}
	} else {
		db.exec(`
			CREATE TABLE tags (
				version_did  TEXT NOT NULL,
				version_rkey TEXT NOT NULL,
				tag          TEXT NOT NULL
			);
		`);
	}

	// --- cursor ---
	db.exec(`
		CREATE TABLE IF NOT EXISTS cursor (
			id     INTEGER PRIMARY KEY CHECK (id = 1),
			cursor INTEGER NOT NULL DEFAULT 0
		);
		INSERT OR IGNORE INTO cursor (id, cursor) VALUES (1, 0);
	`);

	// --- indexes ---
	db.exec(`
		CREATE INDEX IF NOT EXISTS idx_versions_release
			ON versions(release_did, release_rkey);

		CREATE INDEX IF NOT EXISTS idx_stars_subject
			ON stars(subject_uri);

		CREATE INDEX IF NOT EXISTS idx_tags_tag
			ON tags(tag);
	`);
}

// --- Query helpers ---

export type ReleaseRow = {
	did: string;
	rkey: string;
	name: string;
	slug: string;
	description: string | null;
	created_at: string;
	indexed_at: string;
	hidden: number;
};

export type VersionRow = {
	did: string;
	rkey: string;
	release_did: string;
	release_rkey: string;
	version: string;
	viz_cid: string;
	changelog: string | null;
	preview_path: string | null;
	created_at: string;
	indexed_at: string;
};

export type StarRow = {
	did: string;
	rkey: string;
	subject_uri: string;
	created_at: string;
};

export function upsertRelease(
	db: Database,
	row: { did: string; rkey: string; name: string; slug: string; description?: string; created_at: string },
): void {
	db.prepare(`
		INSERT INTO releases (did, rkey, name, slug, description, created_at)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT (did, rkey) DO UPDATE SET
			name = excluded.name,
			slug = excluded.slug,
			description = excluded.description,
			indexed_at = datetime('now')
	`).run(row.did, row.rkey, row.name, row.slug, row.description ?? null, row.created_at);
}

export function upsertVersion(
	db: Database,
	row: {
		did: string;
		rkey: string;
		release_did: string;
		release_rkey: string;
		version: string;
		viz_cid: string;
		changelog?: string;
		created_at: string;
	},
): void {
	db.prepare(`
		INSERT INTO versions (did, rkey, release_did, release_rkey, version, viz_cid, changelog, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (did, rkey) DO NOTHING
	`).run(
		row.did,
		row.rkey,
		row.release_did,
		row.release_rkey,
		row.version,
		row.viz_cid,
		row.changelog ?? null,
		row.created_at,
	);
}

export function upsertStar(
	db: Database,
	row: { did: string; rkey: string; subject_uri: string; created_at: string },
): void {
	db.prepare(`
		INSERT INTO stars (did, rkey, subject_uri, created_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (did, rkey) DO NOTHING
	`).run(row.did, row.rkey, row.subject_uri, row.created_at);
}

export function deleteRelease(db: Database, did: string, rkey: string): void {
	db.prepare("DELETE FROM releases WHERE did = ? AND rkey = ?").run(did, rkey);
}

export function deleteVersion(db: Database, did: string, rkey: string): void {
	db.prepare("DELETE FROM tags WHERE version_did = ? AND version_rkey = ?").run(did, rkey);
	db.prepare("DELETE FROM versions WHERE did = ? AND rkey = ?").run(did, rkey);
}

export function deleteStar(db: Database, did: string, rkey: string): void {
	db.prepare("DELETE FROM stars WHERE did = ? AND rkey = ?").run(did, rkey);
}

export function setVersionPreview(db: Database, did: string, rkey: string, previewPath: string): void {
	db.prepare("UPDATE versions SET preview_path = ? WHERE did = ? AND rkey = ?").run(previewPath, did, rkey);
}

export function getVersionsMissingPreview(db: Database): Array<{ did: string; rkey: string; viz_cid: string }> {
	return db.prepare(
		"SELECT did, rkey, viz_cid FROM versions WHERE preview_path IS NULL AND viz_cid IS NOT NULL"
	).all() as Array<{ did: string; rkey: string; viz_cid: string }>;
}

export function setVersionTags(db: Database, did: string, rkey: string, tags: string[]): void {
	db.prepare("DELETE FROM tags WHERE version_did = ? AND version_rkey = ?").run(did, rkey);
	const insert = db.prepare("INSERT INTO tags (version_did, version_rkey, tag) VALUES (?, ?, ?)");
	for (const tag of tags) {
		insert.run(did, rkey, tag);
	}
}

export function getCursor(db: Database): number {
	const row = db.prepare("SELECT cursor FROM cursor WHERE id = 1").get() as { cursor: number } | null;
	return row?.cursor ?? 0;
}

export function setCursor(db: Database, cursor: number): void {
	db.prepare("UPDATE cursor SET cursor = ? WHERE id = 1").run(cursor);
}

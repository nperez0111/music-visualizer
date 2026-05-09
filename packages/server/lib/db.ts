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
	_db.exec("PRAGMA foreign_keys = ON");

	migrate(_db);
	return _db;
}

function migrate(db: Database): void {
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

		CREATE INDEX IF NOT EXISTS idx_versions_release
			ON versions(release_did, release_rkey);

		CREATE INDEX IF NOT EXISTS idx_stars_subject
			ON stars(subject_uri);

		CREATE INDEX IF NOT EXISTS idx_tags_tag
			ON tags(tag);

		CREATE TABLE IF NOT EXISTS cursor (
			id     INTEGER PRIMARY KEY CHECK (id = 1),
			cursor INTEGER NOT NULL DEFAULT 0
		);

		INSERT OR IGNORE INTO cursor (id, cursor) VALUES (1, 0);
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

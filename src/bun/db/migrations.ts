import type { Database } from "bun:sqlite";

/**
 * A migration runs once on a fresh database that has reached the previous
 * version. Each migration is responsible for moving the schema from `n - 1`
 * to `n`. Migrations execute in order inside a single transaction; on failure
 * the whole batch rolls back.
 *
 * To add a migration: append to the array. Never reorder, edit, or delete an
 * already-shipped entry — users in the wild have already run them.
 */
export type Migration = {
	version: number;
	description: string;
	up: (db: Database) => void;
};

export const migrations: Migration[] = [
	{
		version: 1,
		description: "preferences key/value store",
		up: (db) => {
			db.exec(`
				CREATE TABLE IF NOT EXISTS preferences (
					key   TEXT PRIMARY KEY,
					value TEXT NOT NULL
				);
			`);
		},
	},
];

/**
 * Bring `db` up to the latest schema version. Idempotent — running on an
 * already-current database is a no-op.
 */
export function runMigrations(db: Database): void {
	const current = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
	const target = migrations.reduce((m, x) => Math.max(m, x.version), 0);
	if (current >= target) return;

	db.exec("BEGIN");
	try {
		for (const m of migrations) {
			if (m.version <= current) continue;
			m.up(db);
			console.log(`[db] migrated to v${m.version}: ${m.description}`);
		}
		// PRAGMA user_version doesn't accept bound parameters; safe because we
		// control the value (computed from the static migrations array).
		db.exec(`PRAGMA user_version = ${target}`);
		db.exec("COMMIT");
	} catch (err) {
		db.exec("ROLLBACK");
		throw err;
	}
}

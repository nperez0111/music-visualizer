import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { DB_PATH } from "../paths";
import { runMigrations } from "./migrations";

if (!existsSync(dirname(DB_PATH))) {
	mkdirSync(dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

runMigrations(db);

const upsertStmt = db.prepare(
	"INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)",
);
const selectStmt = db.prepare("SELECT value FROM preferences WHERE key = ?");
const deleteStmt = db.prepare("DELETE FROM preferences WHERE key = ?");
const listLikeStmt = db.prepare("SELECT key FROM preferences WHERE key LIKE ?");

export function getPref<T>(key: string, defaultValue: T): T {
	const row = selectStmt.get(key) as { value: string } | undefined;
	if (!row) return defaultValue;
	try {
		return JSON.parse(row.value) as T;
	} catch {
		return defaultValue;
	}
}

export function setPref(key: string, value: unknown): void {
	upsertStmt.run(key, JSON.stringify(value));
}

export function deletePref(key: string): void {
	deleteStmt.run(key);
}

export function listPrefKeys(prefix: string): string[] {
	const rows = listLikeStmt.all(prefix + "%") as Array<{ key: string }>;
	return rows.map((r) => r.key);
}

export function closeDb(): void {
	db.close();
}

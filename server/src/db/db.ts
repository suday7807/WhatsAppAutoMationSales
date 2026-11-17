import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../config.js';

type Param = string | number | bigint | null | boolean | undefined;

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));

// Migrations for databases created by an older version of schema.sql.
function hasColumn(table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
}
if (!hasColumn('campaigns', 'message_mode')) {
  db.exec("ALTER TABLE campaigns ADD COLUMN message_mode TEXT NOT NULL DEFAULT 'separate'");
}

// node:sqlite rejects undefined/boolean, so normalise every bound value.
function clean(params: Param[]) {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export function all<T = any>(sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...clean(params)) as T[];
}

export function get<T = any>(sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...clean(params)) as T | undefined;
}

export function run(sql: string, ...params: Param[]) {
  const r = db.prepare(sql).run(...clean(params));
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

let depth = 0;
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn(); // already inside a transaction
  db.exec('BEGIN');
  depth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export function getSetting(key: string, fallback: string): string {
  return get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value ?? fallback;
}

export function setSetting(key: string, value: string | number) {
  run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    String(value),
  );
}

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SkillRecord } from "./types.ts";

export interface SeenStore {
  /** true when a skill with this content_hash was recorded before */
  has(contentHash: string): boolean;
  /** record many skills in one transaction (INSERT OR IGNORE) */
  markSeenMany(records: SkillRecord[]): void;
  count(): number;
  close(): void;
}

/**
 * SQLite-backed store of already-seen skill content hashes
 * (node:sqlite DatabaseSync; ":memory:" supported for tests).
 */
export class SQLiteSeenStore implements SeenStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS seen_skills (
        content_hash  TEXT PRIMARY KEY,
        skill_id      TEXT NOT NULL,
        name          TEXT NOT NULL,
        version       TEXT,
        source_url    TEXT NOT NULL,
        first_seen_at TEXT NOT NULL
      )
    `);
  }

  has(contentHash: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS one FROM seen_skills WHERE content_hash = ?")
      .get(contentHash);
    return row !== undefined;
  }

  markSeenMany(records: SkillRecord[]): void {
    if (records.length === 0) return;
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO seen_skills (content_hash, skill_id, name, version, source_url, first_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      for (const record of records) {
        insert.run(
          record.content_hash,
          record.id,
          record.name,
          record.version ?? null,
          record.source_url,
          now,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM seen_skills").get() as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}

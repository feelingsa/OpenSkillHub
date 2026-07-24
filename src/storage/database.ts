import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ProviderId, SkillManifest } from "../types.js";

export class HubDatabase {
  private readonly database: Database.Database;

  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new Database(filename);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS skills_provider_active_idx ON skills(provider, is_deleted);
    `);
  }

  upsertSkill(manifest: SkillManifest): void {
    const now = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO skills (id, provider, source_hash, manifest_json, is_deleted, created_at, updated_at)
        VALUES (@id, @provider, @sourceHash, @manifestJson, 0, @now, @now)
        ON CONFLICT(id) DO UPDATE SET
          source_hash = excluded.source_hash,
          manifest_json = excluded.manifest_json,
          is_deleted = 0,
          updated_at = excluded.updated_at
      `)
      .run({
        id: manifest.id,
        provider: manifest.provider,
        sourceHash: manifest.sourceHash,
        manifestJson: JSON.stringify(manifest),
        now,
      });
  }

  markMissing(provider: ProviderId, activeIds: string[]): void {
    if (activeIds.length === 0) {
      this.database.prepare("UPDATE skills SET is_deleted = 1 WHERE provider = ?").run(provider);
      return;
    }
    const placeholders = activeIds.map(() => "?").join(", ");
    this.database.prepare(`UPDATE skills SET is_deleted = 1 WHERE provider = ? AND id NOT IN (${placeholders})`).run(provider, ...activeIds);
  }

  listSkills(): SkillManifest[] {
    const rows = this.database
      .prepare("SELECT manifest_json FROM skills WHERE is_deleted = 0 ORDER BY json_extract(manifest_json, '$.displayName') COLLATE NOCASE")
      .all() as Array<{ manifest_json: string }>;
    return rows.map((row) => JSON.parse(row.manifest_json) as SkillManifest);
  }

  getSkill(id: string): SkillManifest | undefined {
    const row = this.database
      .prepare("SELECT manifest_json FROM skills WHERE id = ? AND is_deleted = 0")
      .get(id) as { manifest_json: string } | undefined;
    return row ? (JSON.parse(row.manifest_json) as SkillManifest) : undefined;
  }

  close(): void {
    this.database.close();
  }
}

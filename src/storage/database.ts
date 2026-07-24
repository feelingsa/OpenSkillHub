import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ArtifactRecord, GeneratedPageRecord, GeneratedPageStatus, ProviderId, RunEvent, RunInputValues, RunRecord, RunStatus, SkillManifest, StoredRunEvent } from "../types.js";

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
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        session_id TEXT,
        summary TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS runs_owner_created_idx ON runs(owner_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS runs_skill_created_idx ON runs(skill_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS run_events (
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(run_id, sequence),
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        display_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, relative_path),
        FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS artifacts_run_created_idx ON artifacts(run_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS artifacts_owner_created_idx ON artifacts(owner_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS generated_pages (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        version TEXT NOT NULL,
        preset TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        prompt_version TEXT NOT NULL,
        status TEXT NOT NULL,
        output_directory TEXT,
        session_id TEXT,
        view_manifest_json TEXT,
        error_message TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        activated_at TEXT,
        UNIQUE(skill_id, version)
      );
      CREATE INDEX IF NOT EXISTS generated_pages_skill_created_idx ON generated_pages(skill_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS generated_pages_skill_active_idx ON generated_pages(skill_id, is_active);
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

  updateSkillPageStatus(id: string, pageStatus: SkillManifest["pageStatus"]): SkillManifest | undefined {
    const skill = this.getSkill(id);
    if (!skill) return undefined;
    skill.pageStatus = pageStatus;
    this.upsertSkill(skill);
    return skill;
  }

  createRun(run: RunRecord): void {
    this.database.prepare(`
      INSERT INTO runs (id, skill_id, provider, owner_id, status, input_json, workspace_id, session_id, summary, error_message, created_at, updated_at, completed_at)
      VALUES (@id, @skillId, @provider, @ownerId, @status, @inputJson, @workspaceId, @sessionId, @summary, @errorMessage, @createdAt, @updatedAt, @completedAt)
    `).run({
      ...run,
      inputJson: JSON.stringify(run.inputValues),
      sessionId: run.sessionId ?? null,
      summary: run.summary ?? null,
      errorMessage: run.errorMessage ?? null,
      completedAt: run.completedAt ?? null,
    });
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.database.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toRunRecord(row) : undefined;
  }

  updateRun(id: string, update: { status: RunStatus; summary?: string; errorMessage?: string; sessionId?: string; completedAt?: string }): RunRecord | undefined {
    const existing = this.getRun(id);
    if (!existing) return undefined;
    const updatedAt = new Date().toISOString();
    this.database.prepare(`
      UPDATE runs SET status = @status, summary = @summary, error_message = @errorMessage, session_id = @sessionId, updated_at = @updatedAt, completed_at = @completedAt
      WHERE id = @id
    `).run({
      id,
      status: update.status,
      summary: update.summary ?? existing.summary ?? null,
      errorMessage: update.errorMessage ?? existing.errorMessage ?? null,
      sessionId: update.sessionId ?? existing.sessionId ?? null,
      updatedAt,
      completedAt: update.completedAt ?? existing.completedAt ?? null,
    });
    return this.getRun(id);
  }

  appendRunEvent(runId: string, event: RunEvent): StoredRunEvent {
    const row = this.database.prepare("SELECT COALESCE(MAX(sequence), 0) AS latest FROM run_events WHERE run_id = ?").get(runId) as { latest: number };
    const sequence = row.latest + 1;
    const createdAt = new Date().toISOString();
    this.database.prepare("INSERT INTO run_events (run_id, sequence, event_json, created_at) VALUES (?, ?, ?, ?)")
      .run(runId, sequence, JSON.stringify(event), createdAt);
    return { ...event, runId, sequence, createdAt } as StoredRunEvent;
  }

  listRunEvents(runId: string, afterSequence = 0): StoredRunEvent[] {
    const rows = this.database.prepare(`
      SELECT sequence, event_json, created_at FROM run_events WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC
    `).all(runId, afterSequence) as Array<{ sequence: number; event_json: string; created_at: string }>;
    return rows.map((row) => ({
      ...(JSON.parse(row.event_json) as RunEvent),
      runId,
      sequence: row.sequence,
      createdAt: row.created_at,
    }) as StoredRunEvent);
  }

  createArtifact(artifact: ArtifactRecord): void {
    this.database.prepare(`
      INSERT INTO artifacts (id, run_id, owner_id, relative_path, display_name, mime_type, size_bytes, sha256, created_at)
      VALUES (@id, @runId, @ownerId, @relativePath, @displayName, @mimeType, @sizeBytes, @sha256, @createdAt)
      ON CONFLICT(run_id, relative_path) DO NOTHING
    `).run(artifact);
  }

  listArtifacts(runId: string): ArtifactRecord[] {
    const rows = this.database.prepare(`
      SELECT id, run_id, owner_id, relative_path, display_name, mime_type, size_bytes, sha256, created_at
      FROM artifacts WHERE run_id = ? ORDER BY created_at ASC, display_name COLLATE NOCASE ASC
    `).all(runId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toArtifactRecord(row));
  }

  getArtifact(id: string): ArtifactRecord | undefined {
    const row = this.database.prepare(`
      SELECT id, run_id, owner_id, relative_path, display_name, mime_type, size_bytes, sha256, created_at
      FROM artifacts WHERE id = ?
    `).get(id) as Record<string, unknown> | undefined;
    return row ? this.toArtifactRecord(row) : undefined;
  }

  createGeneratedPage(page: GeneratedPageRecord): void {
    this.database.prepare(`
      INSERT INTO generated_pages (id, skill_id, version, preset, source_hash, prompt_version, status, output_directory, session_id, view_manifest_json, error_message, is_active, created_at, updated_at, activated_at)
      VALUES (@id, @skillId, @version, @preset, @sourceHash, @promptVersion, @status, @outputDirectory, @sessionId, @viewManifestJson, @errorMessage, @active, @createdAt, @updatedAt, @activatedAt)
    `).run({
      ...page,
      outputDirectory: page.outputDirectory ?? null,
      sessionId: page.sessionId ?? null,
      viewManifestJson: page.viewManifest ? JSON.stringify(page.viewManifest) : null,
      errorMessage: page.errorMessage ?? null,
      active: page.active ? 1 : 0,
      activatedAt: page.activatedAt ?? null,
    });
  }

  getGeneratedPage(id: string): GeneratedPageRecord | undefined {
    const row = this.database.prepare("SELECT * FROM generated_pages WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? this.toGeneratedPageRecord(row) : undefined;
  }

  listGeneratedPages(skillId: string): GeneratedPageRecord[] {
    const rows = this.database.prepare("SELECT * FROM generated_pages WHERE skill_id = ? ORDER BY created_at DESC").all(skillId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toGeneratedPageRecord(row));
  }

  listGeneratedPagesByStatus(statuses: GeneratedPageStatus[]): GeneratedPageRecord[] {
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => "?").join(", ");
    const rows = this.database.prepare(`SELECT * FROM generated_pages WHERE status IN (${placeholders}) ORDER BY created_at ASC`).all(...statuses) as Array<Record<string, unknown>>;
    return rows.map((row) => this.toGeneratedPageRecord(row));
  }

  getActiveGeneratedPage(skillId: string): GeneratedPageRecord | undefined {
    const row = this.database.prepare("SELECT * FROM generated_pages WHERE skill_id = ? AND is_active = 1 AND status = 'ready' ORDER BY activated_at DESC LIMIT 1").get(skillId) as Record<string, unknown> | undefined;
    return row ? this.toGeneratedPageRecord(row) : undefined;
  }

  findReusableGeneratedPage(skillId: string, sourceHash: string, promptVersion: string): GeneratedPageRecord | undefined {
    const row = this.database.prepare(`
      SELECT * FROM generated_pages
      WHERE skill_id = ? AND source_hash = ? AND prompt_version = ? AND status = 'ready'
      ORDER BY created_at DESC LIMIT 1
    `).get(skillId, sourceHash, promptVersion) as Record<string, unknown> | undefined;
    return row ? this.toGeneratedPageRecord(row) : undefined;
  }

  updateGeneratedPage(id: string, update: Partial<Pick<GeneratedPageRecord, "status" | "outputDirectory" | "sessionId" | "viewManifest" | "errorMessage">>): GeneratedPageRecord | undefined {
    const existing = this.getGeneratedPage(id);
    if (!existing) return undefined;
    const updatedAt = new Date().toISOString();
    this.database.prepare(`
      UPDATE generated_pages SET status = @status, output_directory = @outputDirectory, session_id = @sessionId,
        view_manifest_json = @viewManifestJson, error_message = @errorMessage, updated_at = @updatedAt
      WHERE id = @id
    `).run({
      id,
      status: update.status ?? existing.status,
      outputDirectory: update.outputDirectory ?? existing.outputDirectory ?? null,
      sessionId: update.sessionId ?? existing.sessionId ?? null,
      viewManifestJson: update.viewManifest ? JSON.stringify(update.viewManifest) : existing.viewManifest ? JSON.stringify(existing.viewManifest) : null,
      errorMessage: update.errorMessage ?? existing.errorMessage ?? null,
      updatedAt,
    });
    return this.getGeneratedPage(id);
  }

  activateGeneratedPage(skillId: string, version: string): GeneratedPageRecord | undefined {
    const candidate = this.database.prepare("SELECT id FROM generated_pages WHERE skill_id = ? AND version = ? AND status = 'ready'").get(skillId, version) as { id: string } | undefined;
    if (!candidate) return undefined;
    const now = new Date().toISOString();
    const transaction = this.database.transaction(() => {
      this.database.prepare("UPDATE generated_pages SET is_active = 0 WHERE skill_id = ?").run(skillId);
      this.database.prepare("UPDATE generated_pages SET is_active = 1, activated_at = ?, updated_at = ? WHERE id = ?").run(now, now, candidate.id);
    });
    transaction();
    return this.getGeneratedPage(candidate.id);
  }

  private toRunRecord(row: Record<string, unknown>): RunRecord {
    return {
      id: String(row.id),
      skillId: String(row.skill_id),
      provider: row.provider as ProviderId,
      ownerId: String(row.owner_id),
      status: row.status as RunStatus,
      inputValues: JSON.parse(String(row.input_json)) as RunInputValues,
      workspaceId: String(row.workspace_id),
      ...(typeof row.session_id === "string" ? { sessionId: row.session_id } : {}),
      ...(typeof row.summary === "string" ? { summary: row.summary } : {}),
      ...(typeof row.error_message === "string" ? { errorMessage: row.error_message } : {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      ...(typeof row.completed_at === "string" ? { completedAt: row.completed_at } : {}),
    };
  }

  private toArtifactRecord(row: Record<string, unknown>): ArtifactRecord {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      ownerId: String(row.owner_id),
      relativePath: String(row.relative_path),
      displayName: String(row.display_name),
      mimeType: String(row.mime_type),
      sizeBytes: Number(row.size_bytes),
      sha256: String(row.sha256),
      createdAt: String(row.created_at),
    };
  }

  private toGeneratedPageRecord(row: Record<string, unknown>): GeneratedPageRecord {
    return {
      id: String(row.id),
      skillId: String(row.skill_id),
      version: String(row.version),
      preset: row.preset as GeneratedPageRecord["preset"],
      sourceHash: String(row.source_hash),
      promptVersion: String(row.prompt_version),
      status: row.status as GeneratedPageStatus,
      ...(typeof row.output_directory === "string" ? { outputDirectory: row.output_directory } : {}),
      ...(typeof row.session_id === "string" ? { sessionId: row.session_id } : {}),
      ...(typeof row.view_manifest_json === "string" ? { viewManifest: JSON.parse(row.view_manifest_json) as GeneratedPageRecord["viewManifest"] } : {}),
      ...(typeof row.error_message === "string" ? { errorMessage: row.error_message } : {}),
      active: Number(row.is_active) === 1,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      ...(typeof row.activated_at === "string" ? { activatedAt: row.activated_at } : {}),
    };
  }

  close(): void {
    this.database.close();
  }
}

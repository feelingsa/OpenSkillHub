export type ProviderId = "opencode";

export type UserRole = "administrator" | "user";

export interface UserRecord {
  id: string;
  username: string;
  role: UserRole;
  disabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedUser extends UserRecord {
  expiresAt: string;
  csrfToken: string;
}

export type SkillInputKind = "text" | "number" | "boolean" | "select" | "url" | "file" | "project";

export interface SkillInput {
  id: string;
  label: string;
  kind: SkillInputKind;
  required: boolean;
  description?: string;
  defaultValue?: string | number | boolean;
  options?: Array<{ label: string; value: string }>;
  confidence: "high" | "low";
}

export interface SkillOutput {
  id: string;
  label: string;
  description?: string;
}

export interface SkillWorkflowStep {
  id: string;
  label: string;
  description?: string;
}

export interface SkillRequirement {
  id: string;
  label: string;
  required: boolean;
}

export interface SkillAsset {
  id: string;
  name: string;
  kind: "image" | "document" | "other";
}

export interface SkillManifest {
  id: string;
  provider: ProviderId;
  name: string;
  displayName: string;
  description: string;
  sourcePath: string;
  sourceHash: string;
  inputs: SkillInput[];
  outputs: SkillOutput[];
  workflow: SkillWorkflowStep[];
  requirements: SkillRequirement[];
  assets: SkillAsset[];
  pageStatus: "missing" | "queued" | "generating" | "ready" | "failed" | "stale";
  enabled: boolean;
  lastScannedAt: string;
}

export type PublicSkillManifest = Omit<SkillManifest, "sourcePath">;

export interface ProviderHealth {
  provider: ProviderId;
  status: "healthy" | "offline" | "starting" | "misconfigured";
  checkedAt: string;
  message?: string;
}

export type RunStatus = "created" | "running" | "waiting_question" | "waiting_permission" | "completed" | "failed" | "aborted";

export type RunInputValues = Record<string, string | number | boolean>;

export type RunEvent =
  | { type: "run.created" }
  | { type: "run.started" }
  | { type: "message.delta"; text: string }
  | { type: "tool.started"; tool: string }
  | { type: "tool.finished"; tool: string }
  | { type: "question.pending"; questionId: string; question: string }
  | { type: "permission.pending"; permissionId: string; permission: string }
  | { type: "artifact.created"; artifactId: string }
  | { type: "run.completed" }
  | { type: "run.failed"; message: string }
  | { type: "run.aborted" };

export type StoredRunEvent = RunEvent & {
  runId: string;
  sequence: number;
  createdAt: string;
};

export interface RunRecord {
  id: string;
  skillId: string;
  provider: ProviderId;
  ownerId: string;
  status: RunStatus;
  inputValues: RunInputValues;
  workspaceId: string;
  sessionId?: string;
  summary?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  ownerId: string;
  relativePath: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export interface UploadRecord {
  id: string;
  ownerId: string;
  storageName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
}

export type GeneratedPagePreset = "form-first" | "workflow-console" | "artifact-workbench";
export type GeneratedPageStatus = "queued" | "generating" | "ready" | "failed";

export interface GeneratedPageRecord {
  id: string;
  skillId: string;
  version: string;
  preset: GeneratedPagePreset;
  sourceHash: string;
  promptVersion: string;
  status: GeneratedPageStatus;
  outputDirectory?: string;
  sessionId?: string;
  viewManifest?: {
    contractVersion: 1;
    preset: GeneratedPagePreset;
    sourceHash: string;
    inputIds: string[];
    runtime: "shared";
  };
  errorMessage?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
}

export interface GeneratedPageEvent {
  pageId: string;
  sequence: number;
  type: string;
  message: string;
  createdAt: string;
}

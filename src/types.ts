export type ProviderId = "opencode";

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

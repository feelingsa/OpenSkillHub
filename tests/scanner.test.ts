import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { HubConfig } from "../src/config.js";
import type { OpenCodeProvider } from "../src/providers/opencode/provider.js";
import { SkillScanner } from "../src/skills/scanner.js";
import { HubDatabase } from "../src/storage/database.js";

let testDirectory = "";

afterEach(async () => {
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
  testDirectory = "";
});

describe("SkillScanner", () => {
  it("scans allowed roots and retains prior data when a configured root becomes unavailable", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-scanner-"));
    const root = path.join(testDirectory, "skills");
    const skillDirectory = path.join(root, "example");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, "SKILL.md"), "---\nname: example\ndescription: Test Skill\n---\n# Example\n\n## Inputs\n- `title`: required title\n");
    await writeFile(path.join(skillDirectory, "preview.svg"), "<svg />");

    const config: HubConfig = {
      projectRoot: testDirectory,
      host: "127.0.0.1",
      port: 0,
      databasePath: path.join(testDirectory, "hub.db"),
      skillSyncIntervalMs: 60000,
      runTimeoutMs: 60000,
      logLevel: "fatal",
      opencode: {
        mode: "connect",
        url: new URL("http://127.0.0.1:1"),
        command: "opencode",
        args: [],
        workingDirectory: testDirectory,
        configDirectory: path.join(testDirectory, "opencode-config"),
        dataDirectory: path.join(testDirectory, "opencode-data"),
        lockFilePath: path.join(testDirectory, "opencode.lock"),
        logFilePath: path.join(testDirectory, "opencode.log"),
        startTimeoutMs: 1000,
        skillRoots: [root],
        includeApiSkills: true,
      },
    };
    const provider = {
      listSkills: async () => [],
      getHealthSnapshot: () => ({ provider: "opencode", status: "offline", checkedAt: new Date().toISOString() }),
    } as unknown as OpenCodeProvider;
    const database = new HubDatabase(config.databasePath);
    try {
      const first = await new SkillScanner(config, provider, database).sync();
      expect(first.total).toBe(1);
      expect(database.listSkills()[0]).toMatchObject({ id: "opencode--example", displayName: "example", assets: [{ name: "preview.svg", kind: "image" }] });

      config.opencode.skillRoots = [path.join(testDirectory, "missing")];
      const second = await new SkillScanner(config, provider, database).sync();
      expect(second.warnings).toHaveLength(1);
      expect(second.disabledOrRemoved).toBe(0);
      expect(database.listSkills()).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("can scan only configured filesystem roots when API discovery is disabled", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-scanner-filesystem-only-"));
    const root = path.join(testDirectory, "skills");
    const skillDirectory = path.join(root, "local-only");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(path.join(skillDirectory, "SKILL.md"), "# Local only\n");

    const config: HubConfig = {
      projectRoot: testDirectory,
      host: "127.0.0.1",
      port: 0,
      databasePath: path.join(testDirectory, "hub.db"),
      skillSyncIntervalMs: 60000,
      runTimeoutMs: 60000,
      logLevel: "fatal",
      opencode: {
        mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: testDirectory,
        configDirectory: path.join(testDirectory, "opencode-config"), dataDirectory: path.join(testDirectory, "opencode-data"), lockFilePath: path.join(testDirectory, "opencode.lock"), logFilePath: path.join(testDirectory, "opencode.log"), startTimeoutMs: 1000,
        skillRoots: [root], includeApiSkills: false,
      },
    };
    const provider = {
      listSkills: async () => { throw new Error("API discovery must not run"); },
      getHealthSnapshot: () => ({ provider: "opencode", status: "healthy", checkedAt: new Date().toISOString() }),
    } as unknown as OpenCodeProvider;
    const database = new HubDatabase(config.databasePath);
    try {
      const summary = await new SkillScanner(config, provider, database).sync();
      expect(summary.sources).toEqual({ api: 0, filesystem: 1 });
      expect(database.listSkills()).toHaveLength(1);
      expect(database.listSkills()[0]).toMatchObject({ id: "opencode--local-only" });
    } finally {
      database.close();
    }
  });
});

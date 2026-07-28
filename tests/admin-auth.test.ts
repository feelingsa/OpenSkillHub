import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { HubConfig } from "../src/config.js";

let testDirectory = "";

afterEach(async () => {
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
  testDirectory = "";
});

describe("administrator authentication", () => {
  it("blocks admin APIs until a password-authenticated session is established", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-admin-"));
    const config: HubConfig = {
      projectRoot: path.resolve(import.meta.dirname, ".."), host: "127.0.0.1", port: 0, databasePath: path.join(testDirectory, "hub.db"),
      skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal",
      admin: { username: "operator", password: "correct-horse-battery-staple", sessionTtlMs: 60000 },
      opencode: {
        mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: testDirectory,
        configDirectory: path.join(testDirectory, "config"), dataDirectory: path.join(testDirectory, "data"), lockFilePath: path.join(testDirectory, "lock"), logFilePath: path.join(testDirectory, "log"), startTimeoutMs: 1000, skillRoots: [],
      },
    };
    const app = await buildServer(config);
    try {
      const blocked = await app.inject({ method: "GET", url: "/api/admin/overview" });
      expect(blocked.statusCode).toBe(401);

      const rejected = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "operator", password: "wrong-password" } });
      expect(rejected.statusCode).toBe(401);

      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "operator", password: "correct-horse-battery-staple" } });
      expect(login.statusCode).toBe(200);
      const setCookie = login.headers["set-cookie"];
      const firstCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(firstCookie).toBeTypeOf("string");
      const cookie = firstCookie!.split(";")[0];
      const csrfToken = login.json().csrfToken as string;
      expect(cookie).toContain("skill_hub_session=");

      const createdUser = await app.inject({
        method: "POST",
        url: "/api/admin/users",
        headers: { cookie, "x-csrf-token": csrfToken },
        payload: { username: "short-password-user", password: "x", role: "user" },
      });
      expect(createdUser.statusCode).toBe(201);
      const shortPasswordLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "short-password-user", password: "x" } });
      expect(shortPasswordLogin.statusCode).toBe(200);

      const overview = await app.inject({ method: "GET", url: "/api/admin/overview", headers: { cookie } });
      expect(overview.statusCode).toBe(200);
      expect(overview.json()).toMatchObject({ runtime: { service: "open-skill-hub" }, skills: { total: 0 } });
      expect(overview.body).not.toContain("127.0.0.1:1");

      const cleanupPreview = await app.inject({ method: "GET", url: "/api/admin/storage/cleanup/preview", headers: { cookie } });
      expect(cleanupPreview.statusCode).toBe(200);
      const cleanupWithoutConfirmation = await app.inject({ method: "POST", url: "/api/admin/storage/cleanup", headers: { cookie, "x-csrf-token": csrfToken }, payload: {} });
      expect(cleanupWithoutConfirmation.statusCode).toBe(409);
      const diagnostics = await app.inject({ method: "GET", url: "/api/admin/diagnostics", headers: { cookie } });
      expect(diagnostics.statusCode).toBe(200);
      expect(diagnostics.body).not.toContain("127.0.0.1:1");
    } finally {
      await app.close();
    }
  });

  it("creates the configured initial non-administrator account", async () => {
    testDirectory = await mkdtemp(path.join(tmpdir(), "skill-web-hub-bootstrap-user-"));
    const config: HubConfig = {
      projectRoot: path.resolve(import.meta.dirname, ".."), host: "127.0.0.1", port: 0, databasePath: path.join(testDirectory, "hub.db"),
      skillSyncIntervalMs: 60000, runTimeoutMs: 60000, logLevel: "fatal",
      admin: { username: "admim", password: "admim", sessionTtlMs: 60000 },
      initialUser: { username: "123", password: "123" },
      passwordMinLength: 3,
      opencode: {
        mode: "connect", url: new URL("http://127.0.0.1:1"), command: "opencode", args: [], workingDirectory: testDirectory,
        configDirectory: path.join(testDirectory, "config"), dataDirectory: path.join(testDirectory, "data"), lockFilePath: path.join(testDirectory, "lock"), logFilePath: path.join(testDirectory, "log"), startTimeoutMs: 1000, skillRoots: [],
      },
    };
    const app = await buildServer(config);
    try {
      const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "123", password: "123" } });
      expect(login.statusCode).toBe(200);
      expect(login.json()).toMatchObject({ username: "123", role: "user" });
    } finally {
      await app.close();
    }
  });
});

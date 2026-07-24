import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { HubConfig } from "../config.js";
import type { HubDatabase } from "../storage/database.js";

const cookieName = "skill_hub_admin";

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readCookie(request: FastifyRequest): string | undefined {
  const cookie = request.headers.cookie;
  if (!cookie) return undefined;
  return cookie.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}

function sameSecret(actual: string, supplied: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class AdminAuthService {
  private readonly username: string;
  private readonly password: string;
  private readonly ttlMs: number;

  constructor(config: HubConfig, private readonly database: HubDatabase) {
    this.username = config.admin?.username ?? "admin";
    this.password = config.admin?.password ?? "change-me-before-lan-use";
    this.ttlMs = config.admin?.sessionTtlMs ?? 86400000;
  }

  login(username: unknown, password: unknown): { username: string; expiresAt: string; token: string } | undefined {
    if (typeof username !== "string" || typeof password !== "string" || !sameSecret(this.username, username) || !sameSecret(this.password, password)) return undefined;
    this.database.purgeExpiredAdminSessions();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
    this.database.createAdminSession(hash(token), this.username, expiresAt);
    return { username: this.username, expiresAt, token };
  }

  getSession(request: FastifyRequest): { username: string; expiresAt: string } | undefined {
    const token = readCookie(request);
    return token ? this.database.getAdminSession(hash(token)) : undefined;
  }

  logout(request: FastifyRequest, reply: FastifyReply): void {
    const token = readCookie(request);
    if (token) this.database.deleteAdminSession(hash(token));
    reply.header("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }

  setSessionCookie(reply: FastifyReply, token: string, expiresAt: string): void {
    const seconds = Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
    reply.header("Set-Cookie", `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}`);
  }
}

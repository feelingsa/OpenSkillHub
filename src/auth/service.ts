import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { HubConfig } from "../config.js";
import type { HubDatabase } from "../storage/database.js";
import type { AuthenticatedUser, UserRecord, UserRole } from "../types.js";

const cookieName = "skill_hub_session";
const usernamePattern = /^[a-zA-Z0-9._-]{3,80}$/;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const derived = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt-v1$${salt}$${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [version, salt, derived] = stored.split("$");
  if (version !== "scrypt-v1" || !salt || !derived) return false;
  const expected = Buffer.from(derived, "base64url");
  const supplied = scryptSync(password, salt, 64);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function readCookie(request: FastifyRequest): string | undefined {
  const cookie = request.headers.cookie;
  if (!cookie) return undefined;
  return cookie.split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AdminAuthService {
  private readonly username: string;
  private readonly password: string;
  private readonly initialUser: HubConfig["initialUser"];
  private readonly passwordMinLength: number;
  private readonly ttlMs: number;

  constructor(private readonly config: HubConfig, private readonly database: HubDatabase) {
    this.username = config.admin?.username ?? "admin";
    this.password = config.admin?.password ?? "change-me-before-lan-use";
    this.initialUser = config.initialUser;
    this.passwordMinLength = config.passwordMinLength ?? 1;
    this.ttlMs = config.admin?.sessionTtlMs ?? 86400000;
  }

  ensureBootstrapAdministrator(): UserRecord {
    const existing = this.database.getUserByUsername(this.username);
    if (existing) return existing;
    const now = new Date().toISOString();
    const user: UserRecord = { id: randomUUID(), username: this.username, role: "administrator", disabled: false, createdAt: now, updatedAt: now };
    this.database.createUser(user, hashPassword(this.password));
    return user;
  }

  ensureBootstrapAccounts(): void {
    this.ensureBootstrapAdministrator();
    if (!this.initialUser || this.database.getUserByUsername(this.initialUser.username)) return;
    const now = new Date().toISOString();
    this.database.createUser(
      { id: randomUUID(), username: this.initialUser.username, role: "user", disabled: false, createdAt: now, updatedAt: now },
      hashPassword(this.initialUser.password),
    );
  }

  login(username: unknown, password: unknown): { user: AuthenticatedUser; token: string } | undefined {
    if (typeof username !== "string" || typeof password !== "string") {
      this.database.appendAuditEvent({ type: "auth.login_failed" });
      return undefined;
    }
    this.ensureBootstrapAccounts();
    const account = this.database.getUserByUsername(username);
    if (!account || account.disabled || !account.passwordHash || !verifyPassword(password, account.passwordHash)) {
      this.database.appendAuditEvent({ userId: account?.id, type: "auth.login_failed" });
      return undefined;
    }
    this.database.purgeExpiredUserSessions();
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + this.ttlMs).toISOString();
    this.database.createUserSession(hash(token), account.id, expiresAt, csrfToken);
    this.database.appendAuditEvent({ userId: account.id, type: "auth.login_succeeded" });
    const { passwordHash: _passwordHash, ...user } = account;
    return { user: { ...user, expiresAt, csrfToken }, token };
  }

  getSession(request: FastifyRequest): AuthenticatedUser | undefined {
    const token = readCookie(request);
    return token ? this.database.getUserSession(hash(token)) : undefined;
  }

  hasValidCsrfToken(request: FastifyRequest, session: AuthenticatedUser): boolean {
    const supplied = request.headers["x-csrf-token"];
    if (typeof supplied !== "string" || !session.csrfToken) return false;
    const expectedBuffer = Buffer.from(session.csrfToken);
    const suppliedBuffer = Buffer.from(supplied);
    return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
  }

  logout(request: FastifyRequest, reply: FastifyReply): void {
    const token = readCookie(request);
    const session = token ? this.database.getUserSession(hash(token)) : undefined;
    if (token) this.database.deleteUserSession(hash(token));
    if (session) this.database.appendAuditEvent({ userId: session.id, type: "auth.logout" });
    reply.header("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${this.config.cookieSecure ? "; Secure" : ""}`);
  }

  setSessionCookie(reply: FastifyReply, token: string, expiresAt: string): void {
    const seconds = Math.max(1, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
    reply.header("Set-Cookie", `${cookieName}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${this.config.cookieSecure ? "; Secure" : ""}`);
  }

  createUser(username: unknown, password: unknown, role: unknown = "user"): UserRecord {
    if (typeof username !== "string" || !usernamePattern.test(username)) throw new AuthenticationError("Username must be 3-80 letters, numbers, dots, underscores, or hyphens.");
    if (typeof password !== "string" || password.length < this.passwordMinLength || password.length > 256) throw new AuthenticationError(`Password must be ${this.passwordMinLength}-256 characters.`);
    if (role !== "user" && role !== "administrator") throw new AuthenticationError("Invalid user role.");
    if (this.database.getUserByUsername(username)) throw new AuthenticationError("Username is already in use.");
    const now = new Date().toISOString();
    const user: UserRecord = { id: randomUUID(), username, role: role as UserRole, disabled: false, createdAt: now, updatedAt: now };
    this.database.createUser(user, hashPassword(password));
    return user;
  }

  updateUser(id: string, update: { role?: unknown; disabled?: unknown; password?: unknown }): UserRecord | undefined {
    const role = update.role === undefined ? undefined : update.role;
    if (role !== undefined && role !== "user" && role !== "administrator") throw new AuthenticationError("Invalid user role.");
    if (update.disabled !== undefined && typeof update.disabled !== "boolean") throw new AuthenticationError("Disabled must be true or false.");
    let passwordHash: string | undefined;
    if (update.password !== undefined) {
      if (typeof update.password !== "string" || update.password.length < this.passwordMinLength || update.password.length > 256) throw new AuthenticationError(`Password must be ${this.passwordMinLength}-256 characters.`);
      passwordHash = hashPassword(update.password);
    }
    return this.database.updateUser(id, { role: role as UserRole | undefined, disabled: update.disabled as boolean | undefined, passwordHash });
  }
}

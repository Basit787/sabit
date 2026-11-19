/*
 * The files authentication adds to a project, all in src/auth/: index.ts (what routes and middleware
 * import), session.ts (who is calling), seed.ts (the development admin) and utils/, one helper per
 * file. Routes stay in src/routes/auth/, since their folders are the URLs.
 */

export type AuthKind = "jwt" | "better-auth";

const ADMIN_HINT: Record<AuthKind, string> = {
  jwt: "POST /auth/login",
  "better-auth": "POST /auth/login",
};

// The next-step line about the seeded admin account.
export function adminHint(kind: AuthKind): string {
  return `Then sign in at ${ADMIN_HINT[kind]} as admin@example.com / 12345678 and change the password (development only)`;
}

/*
 * `src/auth/index.ts` until real authentication is added (`sabit setup`): fixed tokens from the
 * environment, compared in constant time.
 */
export function authPlaceholderFile(): string {
  return `import { timingSafeEqual } from "node:crypto";
import { type RouteContext, unauthorized } from "@sabit/router";

/*
 * Who is calling. Replace with your real auth, or run \`sabit setup\` and pick Authentication.
 * For now "Authorization: Bearer <ADMIN_TOKEN>" is an admin and "Bearer <AUTH_TOKEN>" a user;
 * no header means nobody is signed in, and any other token answers 401.
 */
export function currentUser(ctx: RouteContext) {
  const header = ctx.headers.get("authorization");
  if (!header) return undefined;
  const token = header.replace(/^Bearer /, "");
  if (sameSecret(token, process.env.ADMIN_TOKEN)) return { id: "admin", role: "admin" };
  if (sameSecret(token, process.env.AUTH_TOKEN)) return { id: "user", role: "user" };
  throw unauthorized("Invalid or expired token");
}

// Compares in constant time, so response timing doesn't reveal the secret.
function sameSecret(given: string | undefined, secret: string | undefined): boolean {
  if (!given || !secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}
`;
}

// What an admin may change on an account (`users/schema.ts`), for both kinds of auth.
export const ACCOUNTS_SCHEMA = `import { defineSchema } from "@sabit/schema";

// What PATCH /users/:id may change. Anything else (password, email) is dropped.
export default defineSchema({
  name: { type: String, trim: true, minLength: 1, maxLength: 100 },
  role: { type: String, enum: ["user", "admin"] },
});
`;

// Who may call the auth and account routes, for the access list in src/middleware.ts.
export const AUTH_ACCESS: Record<AuthKind, Record<string, string>> = {
  jwt: {
    "/auth/login": "false",
    "/auth/logout": "false",
    "/auth/me": "true",
    "/auth/refresh": "false",
    "/auth/register": "false",
    "/users": '"admin"',
    "/users/[id]": '"admin"',
  },
  "better-auth": {
    "/auth/login": "false",
    "/auth/logout": "false",
    "/auth/me": "true",
    "/auth/register": "false",
    "/users": '"admin"',
    "/users/[id]": '"admin"',
  },
};

// Every file of an auth kind, as [path, content]. `ext` is the import extension.
export function authFiles(kind: AuthKind, ext: string): Array<[string, string]> {
  return kind === "jwt" ? jwtFiles(ext) : betterAuthFiles(ext);
}

// The files an older sabit wrote for auth, replaced by src/auth/.
export const LEGACY_AUTH_FILES = ["src/auth.ts", "src/db/seed.ts"];

// Better Auth's catch-all route from an earlier sabit, replaced by one folder per endpoint.
export const OLD_AUTH_ROUTES = ["src/routes/auth/[...all]/api.ts"];

function jwtFiles(ext: string): Array<[string, string]> {
  const schema = (fields: string) =>
    `import { defineSchema } from "@sabit/schema";\n\nexport default defineSchema({\n${fields}});\n`;
  return [
    [
      "src/auth/index.ts",
      `// Custom JWT sign-in. Routes and src/middleware.ts import from here; each part
// lives in its own file next to this one (utils/ holds the small helpers).
export { login, logout, me, refresh, register } from "./handlers${ext}";
export { currentUser } from "./session${ext}";
export { hashPassword, verifyPassword } from "./utils/password${ext}";
export { publicUser } from "./utils/public-user${ext}";
`,
    ],
    [
      "src/auth/session.ts",
      `import { type RouteContext, unauthorized } from "@sabit/router";
import { refreshTokenRepository } from "#src/db/refresh-tokens.repository.pattern${ext}";
import type { User } from "#src/db/users.repository.pattern${ext}";
import { ACCESS_COOKIE, readCookie, REFRESH_COOKIE, setCookie } from "./utils/cookies${ext}";
import { ACCESS_TOKEN_SECONDS, signAccessToken, verifyAccessToken } from "./utils/jwt${ext}";
import { newRefreshToken, REFRESH_TOKEN_SECONDS, sha256 } from "./utils/refresh-token${ext}";

/*
 * Signs a user in: a 15-minute access token and a 30-day refresh token (only its SHA-256 is
 * stored), returned as Set-Cookie headers.
 */
export async function startSession(user: User): Promise<Array<[string, string]>> {
  const refreshToken = newRefreshToken();
  await refreshTokenRepository.create({
    userId: String(user.id),
    tokenHash: sha256(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_SECONDS * 1000),
  });
  return [
    setCookie(ACCESS_COOKIE, await signAccessToken(user), ACCESS_TOKEN_SECONDS, "/"),
    setCookie(REFRESH_COOKIE, refreshToken, REFRESH_TOKEN_SECONDS, "/auth"),
  ];
}

// Set-Cookie headers that remove both session cookies.
export function clearSession(): Array<[string, string]> {
  return [setCookie(ACCESS_COOKIE, "", 0, "/"), setCookie(REFRESH_COOKIE, "", 0, "/auth")];
}

// Who is calling: the access_token cookie, or Authorization: Bearer <token>. Undefined when nobody is.
export async function currentUser(ctx: RouteContext) {
  const token =
    readCookie(ctx, ACCESS_COOKIE) ?? ctx.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) return undefined;
  const user = await verifyAccessToken(token);
  if (!user) throw unauthorized("Invalid or expired token");
  return user;
}
`,
    ],
    [
      "src/auth/handlers.ts",
      `import { HttpError, type RouteContext, reply, unauthorized } from "@sabit/router";
import { refreshTokenRepository } from "#src/db/refresh-tokens.repository.pattern${ext}";
import { userRepository } from "#src/db/users.repository.pattern${ext}";
import { clearSession, startSession } from "./session${ext}";
import { readCookie, REFRESH_COOKIE } from "./utils/cookies${ext}";
import { checkPassword, hashPassword } from "./utils/password${ext}";
import { publicUser } from "./utils/public-user${ext}";
import { sha256 } from "./utils/refresh-token${ext}";

// POST /auth/register: a new account (role "user"), signed in.
export async function register(input: { name: string; email: string; password: string }) {
  if (await userRepository.findOne({ email: input.email })) {
    throw new HttpError(409, "This email is already registered");
  }
  const user = await userRepository.create({
    name: input.name,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: "user",
  });
  return reply(201, { user: publicUser(user) }, await startSession(user));
}

// POST /auth/login: email and password in, session cookies out.
export async function login(input: { email: string; password: string }) {
  const user = await userRepository.findOne({ email: input.email });
  if (!(await checkPassword(input.password, user?.passwordHash)) || !user) {
    throw unauthorized("Wrong email or password");
  }
  return reply(200, { user: publicUser(user) }, await startSession(user));
}

/*
 * POST /auth/refresh: trades the refresh token (cookie, or { refreshToken } in the body) for new
 * cookies. Each one works once; a spent token used again was stolen, so every session of the account ends.
 */
export async function refresh(ctx: RouteContext) {
  const token =
    readCookie(ctx, REFRESH_COOKIE) ?? (ctx.body as { refreshToken?: string } | undefined)?.refreshToken;
  if (!token) throw unauthorized("Sign in again");
  const stored = await refreshTokenRepository.findOne({ tokenHash: sha256(token) });
  if (!stored) throw unauthorized("Invalid or expired token");
  if (stored.revokedAt) {
    await refreshTokenRepository.deleteMany({ userId: stored.userId });
    throw unauthorized("Invalid or expired token");
  }
  const user = await userRepository.findById(stored.userId);
  if (!user || new Date(stored.expiresAt) < new Date()) throw unauthorized("Invalid or expired token");
  await refreshTokenRepository.update(String(stored.id), { revokedAt: new Date() });
  return reply(200, { user: publicUser(user) }, await startSession(user));
}

// POST /auth/logout: revokes the refresh token and clears both cookies.
export async function logout(ctx: RouteContext) {
  const token = readCookie(ctx, REFRESH_COOKIE);
  const stored = token && (await refreshTokenRepository.findOne({ tokenHash: sha256(token) }));
  if (stored) await refreshTokenRepository.update(String(stored.id), { revokedAt: new Date() });
  return reply(204, undefined, clearSession());
}

// GET /auth/me: the signed-in account.
export async function me(ctx: RouteContext) {
  const user = await userRepository.findById((ctx.state.user as { id: string }).id);
  if (!user) throw unauthorized("This account no longer exists");
  return publicUser(user);
}
`,
    ],
    [
      "src/auth/seed.ts",
      `import { userRepository } from "#src/db/users.repository.pattern${ext}";
import { hashPassword } from "./utils/password${ext}";

/*
 * The first admin account, admin@example.com / 12345678, created when there's no admin yet (the first
 * start). Change its email and password after signing in; it isn't created again. Never runs in production.
 */
export async function seed(): Promise<void> {
  if (await userRepository.findOne({ role: "admin" })) return;
  await userRepository.create({
    name: "Admin",
    email: "admin@example.com",
    passwordHash: await hashPassword("12345678"),
    role: "admin",
  });
  console.log("Created the admin account: admin@example.com / 12345678 (change the password)");
}

if (process.env.NODE_ENV !== "production") {
  await seed().catch((error) => console.error("Seeding the admin account failed:", error));
}
`,
    ],
    [
      "src/auth/utils/password.ts",
      `import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const hash = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>;

// A salted scrypt hash, stored as "scrypt$<salt>$<hash>".
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return \`scrypt$\${salt.toString("base64")}$\${(await hash(password, salt, 64)).toString("base64")}\`;
}

// Whether the password matches a stored hash; compared in constant time.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, expected] = stored.split("$");
  if (!salt || !expected) return false;
  const actual = await hash(password, Buffer.from(salt, "base64"), 64);
  const wanted = Buffer.from(expected, "base64");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

// Hashed when there's no account, so an unknown email takes as long as a wrong password.
const NO_ACCOUNT = await hashPassword(randomBytes(16).toString("hex"));

// verifyPassword that also takes a missing account (always false, same timing).
export async function checkPassword(password: string, stored: string | undefined): Promise<boolean> {
  const valid = await verifyPassword(password, stored ?? NO_ACCOUNT);
  return valid && stored !== undefined;
}
`,
    ],
    [
      "src/auth/utils/jwt.ts",
      `import { jwtVerify, SignJWT } from "jose";
import "#src/env${ext}";

export const ACCESS_TOKEN_SECONDS = 15 * 60;

// The signing key: JWT_SECRET from .env, at least 32 characters.
function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Set JWT_SECRET in .env to a random string of 32 or more characters");
  }
  return new TextEncoder().encode(secret);
}

// An access token (HS256) for the user: their id as the subject, their role as a claim.
export function signAccessToken(user: { id: unknown; role: string }): Promise<string> {
  return new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(\`\${ACCESS_TOKEN_SECONDS}s\`)
    .sign(secretKey());
}

// The user in a valid access token, or undefined when it's invalid or expired.
export async function verifyAccessToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return { id: String(payload.sub), role: String(payload.role) };
  } catch {
    return undefined;
  }
}
`,
    ],
    [
      "src/auth/utils/cookies.ts",
      `import type { RouteContext } from "@sabit/router";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";

/*
 * A Set-Cookie header. HttpOnly: page scripts can't read it. SameSite=Lax: other sites can't send
 * it with their POSTs (CSRF). Secure in production: HTTPS only.
 */
export function setCookie(name: string, value: string, maxAge: number, path: string): [string, string] {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return [
    "set-cookie",
    \`\${name}=\${value}; Path=\${path}; Max-Age=\${maxAge}; HttpOnly; SameSite=Lax\${secure}\`,
  ];
}

// A cookie of the request, or undefined.
export function readCookie(ctx: RouteContext, name: string): string | undefined {
  for (const part of (ctx.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}
`,
    ],
    [
      "src/auth/utils/refresh-token.ts",
      `import { createHash, randomBytes } from "node:crypto";

export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

// A new random refresh token (sent to the client once, never stored).
export const newRefreshToken = () => randomBytes(32).toString("base64url");

// What the database keeps of a refresh token.
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
`,
    ],
    [
      "src/auth/utils/public-user.ts",
      `import type { User } from "#src/db/users.repository.pattern${ext}";

// What the API shows of an account: never the password hash.
export function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
`,
    ],
    [
      "src/routes/auth/register/api.ts",
      `import type { RouteContext } from "@sabit/router";
import { register } from "#src/auth/index${ext}";

// POST /auth/register: create an account (role "user"); sets the session cookies.
export const POST = ({ body }: RouteContext) => register(body as Parameters<typeof register>[0]);
`,
    ],
    [
      "src/routes/auth/register/schema.ts",
      schema(
        `  name: { type: String, required: true, trim: true, minLength: 1, maxLength: 100 },\n  email: ${EMAIL},\n  password: { type: String, required: true, minLength: 8, maxLength: 128 },\n`,
      ),
    ],
    [
      "src/routes/auth/login/api.ts",
      `import type { RouteContext } from "@sabit/router";
import { login } from "#src/auth/index${ext}";

// POST /auth/login: email and password in; sets the session cookies.
export const POST = ({ body }: RouteContext) => login(body as Parameters<typeof login>[0]);
`,
    ],
    [
      "src/routes/auth/login/schema.ts",
      schema(
        `  email: { type: String, required: true, trim: true, lowercase: true },\n  password: { type: String, required: true, maxLength: 128 },\n`,
      ),
    ],
    [
      "src/routes/auth/refresh/api.ts",
      `import { refresh } from "#src/auth/index${ext}";

// POST /auth/refresh: new session cookies for the refresh_token cookie (rotated).
export const POST = refresh;
`,
    ],
    [
      "src/routes/auth/logout/api.ts",
      `import { logout } from "#src/auth/index${ext}";

// POST /auth/logout: revokes the refresh token and clears the session cookies.
export const POST = logout;
`,
    ],
    [
      "src/routes/auth/me/api.ts",
      `import { me } from "#src/auth/index${ext}";

// GET /auth/me: the signed-in account.
export const GET = me;
`,
    ],
    [
      "src/routes/users/api.ts",
      `import { publicUser } from "#src/auth/index${ext}";
import { userRepository } from "#src/db/users.repository.pattern${ext}";

// GET /users: every account. Admin-only (the access list in src/middleware.ts).
export const GET = async () => (await userRepository.findAll()).map(publicUser);
`,
    ],
    [
      "src/routes/users/[id]/api.ts",
      `import { HttpError, type RouteContext } from "@sabit/router";
import { publicUser } from "#src/auth/index${ext}";
import { type NewUser, userRepository } from "#src/db/users.repository.pattern${ext}";

type Context = RouteContext<"/users/[id]">;

// GET /users/:id: one account. Admin-only, like every /users route.
export const GET = async ({ params }: Context) =>
  publicUser((await userRepository.findById(params.id)) ?? notFound());

// PATCH /users/:id: change the name or role (users/schema.ts); never the password hash.
export const PATCH = async ({ params, body }: Context) =>
  publicUser((await userRepository.update(params.id, body as Partial<NewUser>)) ?? notFound());

// DELETE /users/:id: delete the account.
export const DELETE = async ({ params }: Context) => {
  if (!(await userRepository.delete(params.id))) notFound();
};

function notFound(): never {
  throw new HttpError(404, "User not found");
}
`,
    ],
  ];
}

// An email address in a schema.ts: required, trimmed, lowercase, roughly checked.
export const EMAIL =
  "{ type: String, required: true, trim: true, lowercase: true, match: /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/ }";

function betterAuthFiles(ext: string): Array<[string, string]> {
  return [
    [
      "src/auth/index.ts",
      `// Sign-in with Better Auth (https://better-auth.com). Routes and src/middleware.ts
// import from here; each part lives in its own file next to this one.
export { auth } from "./better-auth${ext}";
export { login, logout, me, register } from "./handlers${ext}";
export { currentUser } from "./session${ext}";
export { callAuth } from "./utils/errors${ext}";
`,
    ],
    [
      "src/auth/better-auth.ts",
      `import { betterAuth } from "better-auth";
import { admin, bearer } from "better-auth/plugins";
import { ENV } from "#src/env${ext}";
import { database, generateId } from "./database${ext}";

// Where the API runs; Better Auth builds its URLs and checks request origins with it.
export const BASE_URL = ENV.BETTER_AUTH_URL ?? "http://localhost:3000";

/*
 * Email and password; sessions live in the database behind an HttpOnly cookie
 * (Authorization: Bearer <token> for API clients); roles "user" and "admin". Routes: src/routes/auth/.
 */
export const auth = betterAuth({
  baseURL: BASE_URL,
  basePath: "/auth",
  secret: ENV.BETTER_AUTH_SECRET,
  trustedOrigins: (process.env.CORS_ORIGIN ?? "").split(",").filter(Boolean),
  database,
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  plugins: [admin(), bearer()],
  advanced: { database: { generateId } },
});
`,
    ],
    [
      "src/auth/session.ts",
      `import type { RouteContext } from "@sabit/router";
import { auth } from "./better-auth${ext}";

// Who is calling: the session cookie, or Authorization: Bearer <token>. Undefined when nobody is.
export async function currentUser(ctx: RouteContext) {
  const session = await auth.api.getSession({ headers: ctx.headers });
  if (!session) return undefined;
  return { id: session.user.id, role: session.user.role ?? "user" };
}
`,
    ],
    [
      "src/auth/seed.ts",
      `import { auth } from "./better-auth${ext}";

/*
 * The first admin account, admin@example.com / 12345678, created when there's no admin yet (the first
 * start). Change its email and password after signing in; it isn't created again.
 */
export async function seed(): Promise<void> {
  const { adapter } = await auth.$context;
  const admin = await adapter.findOne({ model: "user", where: [{ field: "role", value: "admin" }] });
  if (admin) return;
  await auth.api.createUser({
    body: {
      name: "Admin",
      email: "admin@example.com",
      password: "12345678",
      role: "admin",
    },
  });
  console.log("Created the admin account: admin@example.com / 12345678 (change the password)");
}

if (process.env.NODE_ENV !== "production") {
  await seed().catch((error) => console.error("Seeding the admin account failed:", error));
}
`,
    ],
    [
      "src/auth/utils/request.ts",
      `import type { RouteContext } from "@sabit/router";

// The request as a web Request to \`url\`, which Better Auth's handler takes; the parsed body is re-sent as JSON.
export function toRequest(ctx: RouteContext, url: URL): Request {
  for (const [key, value] of Object.entries(ctx.query)) {
    for (const item of [value].flat()) url.searchParams.append(key, String(item));
  }
  const headers = new Headers(ctx.headers);
  headers.delete("content-length");
  if (ctx.method === "GET" || ctx.method === "HEAD") {
    return new Request(url, { method: ctx.method, headers });
  }
  headers.set("content-type", "application/json");
  return new Request(url, { method: ctx.method, headers, body: JSON.stringify(ctx.body ?? {}) });
}
`,
    ],
    [
      "src/auth/handlers.ts",
      `import type { RouteContext } from "@sabit/router";
import { auth, BASE_URL } from "./better-auth${ext}";
import { toRequest } from "./utils/request${ext}";

// Runs one Better Auth endpoint for this request (https://better-auth.com/docs): cookies, errors and all.
function call(ctx: RouteContext, endpoint: string): Promise<Response> {
  return auth.handler(toRequest(ctx, new URL(\`/auth\${endpoint}\`, BASE_URL)));
}

// Creates an account (role "user") and signs it in.
export const register = (ctx: RouteContext) => call(ctx, "/sign-up/email");

// Signs in with the email and password.
export const login = (ctx: RouteContext) => call(ctx, "/sign-in/email");

// Ends the session (the cookie, or Authorization: Bearer <token>).
export const logout = (ctx: RouteContext) => call(ctx, "/sign-out");

// The signed-in account and its session.
export const me = (ctx: RouteContext) => call(ctx, "/get-session");
`,
    ],
    [
      "src/auth/utils/errors.ts",
      `import { HttpError } from "@sabit/router";
import { APIError } from "better-auth/api";

// Runs a Better Auth server call (auth.api.*); its errors become HttpErrors with the same status.
export async function callAuth<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof APIError) {
      throw new HttpError(error.statusCode, error.body?.message ?? error.message);
    }
    throw error;
  }
}
`,
    ],
    [
      "src/routes/auth/register/api.ts",
      `import { register } from "#src/auth/index${ext}";

// POST /auth/register: create an account (role "user") and sign it in; sets the session cookie.
export const POST = register;
`,
    ],
    [
      "src/routes/auth/register/schema.ts",
      `import { defineSchema } from "@sabit/schema";

export default defineSchema({
  name: { type: String, required: true, trim: true, minLength: 1, maxLength: 100 },
  email: ${EMAIL},
  password: { type: String, required: true, minLength: 8, maxLength: 128 },
});
`,
    ],
    [
      "src/routes/auth/login/api.ts",
      `import { login } from "#src/auth/index${ext}";

// POST /auth/login: email and password in; sets the session cookie.
export const POST = login;
`,
    ],
    [
      "src/routes/auth/login/schema.ts",
      `import { defineSchema } from "@sabit/schema";

export default defineSchema({
  email: { type: String, required: true, trim: true, lowercase: true },
  password: { type: String, required: true, maxLength: 128 },
});
`,
    ],
    [
      "src/routes/auth/logout/api.ts",
      `import { logout } from "#src/auth/index${ext}";

// POST /auth/logout: ends the session and clears the cookie.
export const POST = logout;
`,
    ],
    [
      "src/routes/auth/me/api.ts",
      `import { me } from "#src/auth/index${ext}";

// GET /auth/me: the signed-in account and its session.
export const GET = me;
`,
    ],
    [
      "src/routes/users/api.ts",
      `import type { RouteContext } from "@sabit/router";
import { auth, callAuth } from "#src/auth/index${ext}";

// GET /users: every account. Admin-only (the access list in src/middleware.ts).
export const GET = async ({ headers }: RouteContext) =>
  (await callAuth(() => auth.api.listUsers({ query: {}, headers }))).users;
`,
    ],
    [
      "src/routes/users/[id]/api.ts",
      `import type { RouteContext } from "@sabit/router";
import { auth, callAuth } from "#src/auth/index${ext}";

type Context = RouteContext<"/users/[id]">;

// GET /users/:id: one account. Admin-only, like every /users route.
export const GET = ({ params, headers }: Context) =>
  callAuth(() => auth.api.getUser({ query: { id: params.id }, headers }));

// PATCH /users/:id: change the name or role (users/schema.ts).
export const PATCH = ({ params, body, headers }: Context) =>
  callAuth(() =>
    auth.api.adminUpdateUser({ body: { userId: params.id, data: body as Record<string, unknown> }, headers }),
  );

// DELETE /users/:id: delete the account and its sessions.
export const DELETE = async ({ params, headers }: Context) => {
  await callAuth(() => auth.api.removeUser({ body: { userId: params.id }, headers }));
};
`,
    ],
  ];
}

/*
 * `src/auth/database.ts` for Better Auth: the ORM's adapter. Tables are plural (users, sessions,
 * accounts, verifications) like the rest of the project; Prisma uses its model names.
 */
export function betterAuthDatabaseFile(orm: string, mongo: boolean, ext: string): string {
  const header = "// Where Better Auth keeps accounts and sessions: this project's database.\n";
  const ids =
    orm === "prisma" && mongo
      ? "\n// MongoDB makes the ids: the schema's ids are ObjectIds (@db.ObjectId).\nexport const generateId = false;\n"
      : "\n// Better Auth makes the ids.\nexport const generateId: false | undefined = undefined;\n";
  if (orm === "prisma") {
    return `import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "#src/db/index${ext}";

${header}export const database = prismaAdapter(prisma, { provider: "${mongo ? "mongodb" : "postgresql"}" });
${ids}`;
  }
  if (orm === "drizzle") {
    return `import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "#src/db/index${ext}";
import * as schema from "#src/db/schema${ext}";

${header}export const database = drizzleAdapter(db, { provider: "pg", schema, usePlural: true });
${ids}`;
  }
  if (orm === "kysely") {
    return `import { kyselyAdapter } from "@better-auth/kysely-adapter";
import { db } from "#src/db/index${ext}";

${header}export const database = kyselyAdapter(db, { type: "postgres", usePlural: true });
${ids}`;
  }
  return `import { mongodbAdapter } from "better-auth/adapters/mongodb";
import mongoose from "mongoose";
import "#src/db/index${ext}";

${header}export const database = mongodbAdapter(mongoose.connection.getClient().db(), { usePlural: true });
${ids}`;
}

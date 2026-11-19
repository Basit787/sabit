import type { RouteContext } from "./context.ts";
import { HttpError } from "./errors.ts";
import type { HttpMethod } from "./methods.ts";
import type { Middleware } from "./middleware.ts";

/*
 * What a route requires for one method: any signed-in user (`true`) or one of
 * these roles. Set from the route file's `export const auth` (see {@link AuthExport}).
 */
export type RouteAuth = true | string | readonly string[];

/*
 * A route's `auth` export: `true` (signed in), a role, roles, or per method: `{ POST: true, DELETE: "admin" }`.
 * Checked against `ctx.state.user` (401 without one, 403 without the role): fails closed.
 */
export type AuthExport =
  | boolean
  | string
  | readonly string[]
  | Partial<Record<HttpMethod, boolean | string | readonly string[]>>;

/*
 * 401 for a request without a signed-in user. `WWW-Authenticate` tells clients
 * to send a bearer token (RFC 6750).
 */
export function unauthorized(message = "Sign in to use this route"): HttpError {
  return new HttpError(401, message, {
    headers: { "www-authenticate": "Bearer" },
    details: { reason: "unauthenticated" },
  });
}

// 403 for a signed-in user without the required role. Doesn't name the role.
export function forbidden(message = "You don't have permission to use this route"): HttpError {
  return new HttpError(403, message, { details: { reason: "forbidden" } });
}

// Throws 401 without `ctx.state.user`, 403 when a role is required and the user lacks it.
export function requireUser(ctx: RouteContext, required: RouteAuth): void {
  const user = (ctx.state as { user?: { role?: unknown } }).user;
  if (!user) throw unauthorized();
  if (required === true) return;
  const roles = typeof required === "string" ? [required] : required;
  if (typeof user.role !== "string" || !roles.includes(user.role)) throw forbidden();
}

/*
 * Applies one route's rule (an `auth` value) to the request: 401 without `ctx.state.user`, 403 without
 * the role. For one access list in src/middleware.ts: `checkAccess(ctx, access[ctx.route])`.
 */
export function checkAccess(ctx: RouteContext, rule: AuthExport | undefined): void {
  const required = ruleFor(rule, ctx.method);
  if (required !== undefined) requireUser(ctx, required);
}

// The requirement for one method from an `auth` value; HEAD needs what GET needs, since GET answers it.
export function ruleFor(rule: AuthExport | undefined, method: HttpMethod): RouteAuth | undefined {
  if (rule === undefined || rule === false) return undefined;
  if (rule === true || typeof rule === "string" || Array.isArray(rule)) return rule as RouteAuth;
  const perMethod = rule as Partial<Record<HttpMethod, boolean | string | readonly string[]>>;
  const value = perMethod[method] ?? (method === "HEAD" ? perMethod.GET : undefined);
  return value === undefined || value === false ? undefined : value;
}

/*
 * A path rule: `path` folder-style (`/products`, `/products/*` one segment, `/admin/**` anything below;
 * default every route), `methods` (default all) and `role` (default any signed-in user).
 */
export interface GuardRule {
  readonly path?: string;
  readonly methods?: readonly HttpMethod[];
  readonly role?: string | readonly string[];
}

/*
 * `user(ctx)`: who is calling (undefined when nobody is signed in). `rules`: extra path rules on top of each
 * route's `auth` export; a request matching neither is public.
 */
export interface GuardOptions<U extends { readonly role?: string }> {
  readonly rules?: readonly GuardRule[];
  user(ctx: RouteContext): U | undefined | Promise<U | undefined>;
}

/*
 * Middleware that puts `user(ctx)` on `ctx.state.user`, then enforces the route's `auth` export and any
 * matching `rules` (401 without a user, 403 without the role).
 */
export function guard<U extends { readonly role?: string }>(options: GuardOptions<U>): Middleware {
  const middleware: Middleware = async (ctx, next) => {
    const required: Array<string | readonly string[] | undefined> = (options.rules ?? [])
      .filter(
        (rule) =>
          (!rule.methods || rule.methods.includes(ctx.method)) &&
          matchesPattern(rule.path ?? "/**", ctx.route),
      )
      .map((rule) => rule.role);
    if (ctx.auth !== undefined) required.push(ctx.auth === true ? undefined : ctx.auth);
    if (required.length === 0) return next();

    const user = await options.user(ctx);
    if (!user) throw unauthorized();
    for (const role of required) {
      if (role === undefined) continue;
      const roles = typeof role === "string" ? [role] : role;
      if (!user.role || !roles.includes(user.role)) throw forbidden();
    }
    (ctx.state as Record<string, unknown>).user = user;
    return next();
  };
  return middleware;
}

// `*` matches one path segment, `**` any number (including none).
export function matchesPattern(pattern: string, route: string): boolean {
  const want = pattern.split("/").filter(Boolean);
  const have = route.split("/").filter(Boolean);
  const match = (i: number, j: number): boolean => {
    if (i === want.length) return j === have.length;
    if (want[i] === "**") return match(i + 1, j) || (j < have.length && match(i, j + 1));
    if (j === have.length) return false;
    return (want[i] === "*" || want[i] === have[j]) && match(i + 1, j + 1);
  };
  return match(0, 0);
}

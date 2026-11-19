import type { RouteContext } from "./context.ts";
import { HttpError } from "./errors.ts";
import type { HttpMethod } from "./methods.ts";
import type { Middleware } from "./middleware.ts";

/** One protection rule: which routes, which methods, and the role needed (if any). */
export interface GuardRule {
  /**
   * Route pattern, folder-style: `/products`, `/products/*` (one segment),
   * `/admin/**` (anything below). Default `/**` (every route).
   */
  readonly path?: string;
  /** Methods the rule covers. Default: every method. */
  readonly methods?: readonly HttpMethod[];
  /** Role (or roles) the user must have. Default: any signed-in user. */
  readonly role?: string | readonly string[];
}

export interface GuardOptions<U extends { readonly role?: string }> {
  /** Protected routes. A request matching no rule is public. */
  readonly rules: readonly GuardRule[];
  /** Who is calling, or undefined when nobody is signed in. */
  user(ctx: RouteContext): U | undefined | Promise<U | undefined>;
}

/**
 * Builds the app's `src/middleware.ts`: one place that decides who may call
 * what. Requests matching a rule need a user (401 without one) with the rule's
 * role (403 otherwise); the user is put on `ctx.state.user`.
 *
 * ```ts
 * export default guard({
 *   rules: [
 *     { path: "/**", methods: ["POST", "PUT", "PATCH", "DELETE"] },
 *     { path: "/admin/**", role: "admin" },
 *   ],
 *   user: (ctx) => verifyToken(ctx.headers.get("authorization")),
 * });
 * ```
 */
export function guard<U extends { readonly role?: string }>(options: GuardOptions<U>): Middleware {
  return async (ctx, next) => {
    const matching = options.rules.filter(
      (rule) =>
        (!rule.methods || rule.methods.includes(ctx.method)) &&
        matchesPattern(rule.path ?? "/**", ctx.route),
    );
    if (matching.length === 0) return next();

    const user = await options.user(ctx);
    if (!user) throw new HttpError(401, "Unauthorized");
    for (const rule of matching) {
      if (rule.role === undefined) continue;
      const roles = typeof rule.role === "string" ? [rule.role] : rule.role;
      if (!user.role || !roles.includes(user.role)) throw new HttpError(403, "Forbidden");
    }
    (ctx.state as Record<string, unknown>).user = user;
    return next();
  };
}

/** `*` matches one path segment, `**` any number (including none). */
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

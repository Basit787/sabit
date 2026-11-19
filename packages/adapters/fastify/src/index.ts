import {
  createContext,
  executeRoute,
  fallbackMethods,
  formatPaths,
  type HttpMethod,
  headersFromRecord,
  type PathDialect,
  queryFromSearchParams,
  type RawParams,
  type RawPlatform,
  type ResolvedRoute,
  type RouteContext,
  type RouteOutcome,
} from "@sabit/router";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
  RouteHandlerMethod,
} from "fastify";

/** Fastify (find-my-way) path syntax. Wildcards are unnamed and stored under `*`. */
export const fastifyDialect: PathDialect = {
  param: (name) => `:${name}`,
  catchAll: () => "*",
  catchAllKey: () => "*",
};

export interface FastifyPlatform extends RawPlatform {
  readonly framework: "fastify";
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
}

export interface FileRoutesPluginOptions {
  readonly routes: readonly ResolvedRoute[];
}

/**
 * Fastify plugin that registers file routes. Use Fastify's own `prefix`
 * option to mount it under a path.
 *
 * ```ts
 * const app = Fastify();
 * await app.register(fileRoutes, {
 *   routes: await loadRoutes(new URL("./routes", import.meta.url)),
 *   prefix: "/api",
 * });
 * ```
 *
 * Fastify parses JSON and `text/plain` bodies itself. The plugin adds parsers
 * for URL-encoded forms and other `text/*` types inside its own encapsulated
 * scope, unless they are already registered.
 */
export const fileRoutes: FastifyPluginAsync<FileRoutesPluginOptions> = async (fastify, options) => {
  addBodyParsers(fastify);

  for (const route of options.routes) {
    const handler = createHandler(route);
    const fallback = fallbackMethods(route);
    for (const url of formatPaths(route, fastifyDialect)) {
      // route.methods lists HEAD before GET, so an explicit HEAD export
      // replaces the HEAD route Fastify would otherwise derive from GET.
      for (const method of route.methods) fastify.route({ method, url, handler });
      if (fallback.length > 0) fastify.route({ method: fallback, url, handler });
    }
  }
};

function createHandler(route: ResolvedRoute): RouteHandlerMethod {
  return async (request, reply) => {
    const method = request.method as HttpMethod;
    const raw: FastifyPlatform = { framework: "fastify", request, reply };
    const ctx = createContext(
      route,
      {
        method,
        url: request.url,
        params: request.params as RawParams,
        headers: headersFromRecord(request.headers),
        body: request.body,
        raw,
      },
      fastifyDialect.catchAllKey,
    );
    return send(reply, await executeRoute(route, method, ctx));
  };
}

function send(reply: FastifyReply, outcome: RouteOutcome): FastifyReply {
  reply.code(outcome.status);
  for (const [name, value] of outcome.headers) {
    if (name !== "set-cookie") reply.header(name, value);
  }
  const cookies = outcome.headers.getSetCookie();
  if (cookies.length > 0) reply.header("set-cookie", cookies);

  const { body } = outcome;
  if (body instanceof Uint8Array) {
    return reply.send(Buffer.from(body.buffer, body.byteOffset, body.byteLength));
  }
  return reply.send(body ?? undefined);
}

function addBodyParsers(fastify: FastifyInstance): void {
  const form = "application/x-www-form-urlencoded";
  if (!fastify.hasContentTypeParser(form)) {
    fastify.addContentTypeParser(form, { parseAs: "string" }, (_request, body, done) => {
      done(null, queryFromSearchParams(new URLSearchParams(body as string)));
    });
  }
  const text = /^text\//;
  if (!fastify.hasContentTypeParser(text)) {
    fastify.addContentTypeParser(text, { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });
  }
}

/**
 * Returns Fastify's native request and reply for a request handled by this
 * adapter. Throws if the request came through a different adapter.
 */
export function getFastify(ctx: RouteContext): { request: FastifyRequest; reply: FastifyReply } {
  if (ctx.raw.framework !== "fastify") {
    throw new Error(`getFastify() called for a request handled by ${ctx.raw.framework}`);
  }
  const { request, reply } = ctx.raw as FastifyPlatform;
  return { request, reply };
}

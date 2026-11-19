import {
  createRunner,
  DEFAULT_BODY_LIMIT,
  type RouteRunner,
  type SecurityOptions,
} from "@sabit/adapter-common";
import {
  createContext,
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

// Fastify (find-my-way) path syntax. Wildcards are unnamed and stored under `*`.
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

/*
 * The routes, plus `bodyLimit` (bytes, default 100 KB like the other adapters; over it, 413) and the
 * shared SecurityOptions.
 */
export interface FileRoutesPluginOptions extends SecurityOptions {
  readonly routes: readonly ResolvedRoute[];
  readonly bodyLimit?: number;
}

/*
 * Fastify plugin registering the file routes (mount with Fastify's `prefix`); adds URL-encoded and
 * `text/*` parsers in its own scope. HEAD is registered before GET, so a HEAD export replaces Fastify's own.
 */
export const fileRoutes: FastifyPluginAsync<FileRoutesPluginOptions> = async (fastify, options) => {
  addBodyParsers(fastify);
  const run = createRunner(options);
  const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;

  for (const route of options.routes) {
    const handler = createHandler(route, run);
    const fallback = fallbackMethods(route);
    for (const url of formatPaths(route, fastifyDialect)) {
      for (const method of route.methods) fastify.route({ method, url, handler, bodyLimit });
      if (fallback.length > 0) fastify.route({ method: fallback, url, handler, bodyLimit });
    }
  }
};

function createHandler(route: ResolvedRoute, run: RouteRunner): RouteHandlerMethod {
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
    return send(reply, await run(route, method, ctx, request.ip));
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

/*
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

export { corsOrigin } from "@sabit/adapter-common";

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RouteOutcome } from "../response.ts";

/*
 * Writes a {@link RouteOutcome} to a Node.js `ServerResponse`. Shared by
 * adapters for Node-based frameworks (Express, NestJS on Express).
 * Resolves once the body has been fully written.
 */
export async function writeNodeResponse(res: ServerResponse, outcome: RouteOutcome): Promise<void> {
  res.statusCode = outcome.status;
  for (const [name, value] of outcome.headers) {
    if (name !== "set-cookie") res.setHeader(name, value);
  }
  const cookies = outcome.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader("set-cookie", cookies);

  const { body } = outcome;
  if (body === null) {
    res.end();
  } else if (typeof body === "string" || body instanceof Uint8Array) {
    res.end(body);
  } else {
    await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream), res);
  }
}

// Whether a Node request carries a body (per RFC 9112: content-length or transfer-encoding).
export function hasNodeBody(req: IncomingMessage): boolean {
  const length = req.headers["content-length"];
  return req.headers["transfer-encoding"] !== undefined || (length !== undefined && length !== "0");
}

// Reads a Node request body as UTF-8 text. Only call it when nothing else consumed the stream.
export async function readNodeText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

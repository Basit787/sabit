import { type HttpError, isHttpError } from "./errors.ts";

const REPLY = Symbol.for("sabit.reply");

// A handler result with an explicit status code and headers. Create it with {@link reply}.
export interface Reply<TBody = unknown, TStatus extends number = number> {
  readonly [REPLY]: true;
  readonly status: TStatus;
  readonly body: TBody;
  readonly headers: Headers;
}

/*
 * A response with an explicit status and headers, e.g. `reply(201, user, { location: "/users/42" })`.
 * The body is serialized like a plain return value.
 */
export function reply<const TStatus extends number, TBody = undefined>(
  status: TStatus,
  body?: TBody,
  headers?: HeadersInit,
): Reply<TBody, TStatus> {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new RangeError(`reply() status must be an integer from 100 to 599, got ${status}`);
  }
  return { [REPLY]: true, status, body: body as TBody, headers: new Headers(headers) };
}

export function isReply(value: unknown): value is Reply {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[REPLY] === true
  );
}

export type OutcomeBody = string | Uint8Array | ReadableStream<Uint8Array> | null;

/*
 * A framework-neutral response. Adapters write it with their native APIs.
 * `body` is already serialized.
 */
export interface RouteOutcome {
  readonly status: number;
  readonly headers: Headers;
  readonly body: OutcomeBody;
}

const JSON_TYPE = "application/json; charset=utf-8";
const TEXT_TYPE = "text/plain; charset=utf-8";
const BINARY_TYPE = "application/octet-stream";

/*
 * A handler's return value as a response: undefined → 204, string → text, bytes/streams → binary,
 * a web Response or reply() → its status and headers, anything else → JSON. An explicit
 * content-type from reply() is kept.
 */
export async function toOutcome(value: unknown): Promise<RouteOutcome> {
  if (value instanceof Response) {
    return { status: value.status, headers: new Headers(value.headers), body: value.body };
  }
  if (isReply(value)) {
    const headers = new Headers(value.headers);
    const body = serializeBody(value.body, headers);
    return { status: value.status, headers, body };
  }
  const headers = new Headers();
  if (value === undefined) return { status: 204, headers, body: null };
  return { status: 200, headers, body: serializeBody(value, headers) };
}

function serializeBody(value: unknown, headers: Headers): OutcomeBody {
  const setType = (type: string) => {
    if (!headers.has("content-type")) headers.set("content-type", type);
  };
  if (value === undefined) return null;
  if (typeof value === "string") {
    setType(TEXT_TYPE);
    return value;
  }
  if (value instanceof Uint8Array) {
    setType(BINARY_TYPE);
    return value;
  }
  if (value instanceof ArrayBuffer) {
    setType(BINARY_TYPE);
    return new Uint8Array(value);
  }
  if (value instanceof ReadableStream) {
    setType(BINARY_TYPE);
    return value as ReadableStream<Uint8Array>;
  }
  setType(JSON_TYPE);
  return JSON.stringify(value);
}

// The response for an {@link HttpError}.
export function errorOutcome(error: HttpError): RouteOutcome {
  const headers = new Headers(error.headers);
  headers.set("content-type", JSON_TYPE);
  return { status: error.status, headers, body: JSON.stringify(error.toJSON()) };
}

// Converts thrown values: HttpErrors become outcomes, anything else is rethrown.
export function outcomeFromError(error: unknown): RouteOutcome {
  if (isHttpError(error)) return errorOutcome(error);
  throw error;
}

// Converts an outcome to a web `Response`, for fetch-based frameworks.
export function outcomeToResponse(outcome: RouteOutcome): Response {
  return new Response(outcome.body as BodyInit | null, {
    status: outcome.status,
    headers: outcome.headers,
  });
}

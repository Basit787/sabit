const HTTP_ERROR = Symbol.for("sabit.http-error");

// `details`: JSON data sent in the error body; `headers`: set on the error response (e.g. WWW-Authenticate).
export interface HttpErrorOptions {
  details?: unknown;
  headers?: Record<string, string>;
  cause?: unknown;
}

/*
 * Throw from a handler or middleware to answer with this status, as
 * `{ "error": { "status": 404, "message": "User not found" } }` on every adapter. Any other error
 * becomes a plain 500 (the adapters log it, never send it).
 */
export class HttpError extends Error {
  readonly status: number;
  readonly details: unknown;
  readonly headers: Record<string, string>;

  constructor(status: number, message?: string, options: HttpErrorOptions = {}) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new RangeError(`HttpError status must be an integer from 400 to 599, got ${status}`);
    }
    super(message ?? defaultMessage(status), { cause: options.cause });
    this.name = "HttpError";
    this.status = status;
    this.details = options.details;
    this.headers = options.headers ?? {};
    Object.defineProperty(this, HTTP_ERROR, { value: true });
  }

  toJSON(): { error: { status: number; message: string; details?: unknown } } {
    const error: { status: number; message: string; details?: unknown } = {
      status: this.status,
      message: this.message,
    };
    if (this.details !== undefined) error.details = this.details;
    return { error };
  }
}

// Works across duplicated copies of this package (e.g. mismatched versions).
export function isHttpError(value: unknown): value is HttpError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[HTTP_ERROR] === true
  );
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
      return "Bad Request";
    case 401:
      return "Unauthorized";
    case 403:
      return "Forbidden";
    case 404:
      return "Not Found";
    case 405:
      return "Method Not Allowed";
    case 409:
      return "Conflict";
    case 422:
      return "Unprocessable Content";
    case 429:
      return "Too Many Requests";
    default:
      return status >= 500 ? "Internal Server Error" : "Request Error";
  }
}

/*
 * A problem with the route tree itself: an invalid file name, a conflict, or a
 * route module with the wrong shape. Thrown at startup, never per request.
 * `problems` lists every issue found, so users can fix them in one pass.
 */
export class RouteDefinitionError extends Error {
  readonly problems: readonly RouteProblem[];

  constructor(problems: readonly RouteProblem[], options?: { cause?: unknown }) {
    super(formatProblems(problems), options);
    this.name = "RouteDefinitionError";
    this.problems = problems;
  }
}

/*
 * A problem in one route file: its path relative to the routes folder (`/`-separated), what's wrong and,
 * when there's an obvious fix, a `hint`.
 */
export interface RouteProblem {
  file: string;
  message: string;
  hint?: string;
}

function formatProblems(problems: readonly RouteProblem[]): string {
  const noun = problems.length === 1 ? "problem" : "problems";
  const lines = problems.map((p) => {
    const hint = p.hint ? `\n    hint: ${p.hint}` : "";
    return `  - ${p.file}: ${p.message}${hint}`;
  });
  return `Found ${problems.length} route ${noun}:\n${lines.join("\n")}`;
}

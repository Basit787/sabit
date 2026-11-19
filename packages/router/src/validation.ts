import { HttpError } from "./errors.ts";
import type { StandardSchemaV1 } from "./standard-schema.ts";

/**
 * Validates a request body against a Standard Schema (a `schema()` or Zod,
 * Valibot, ...). Throws a 400 `HttpError` listing every issue.
 */
export async function validateBody(validator: StandardSchemaV1, body: unknown): Promise<unknown> {
  const result = await validator["~standard"].validate(body);
  if (!result.issues) return result.value;
  const issues = result.issues.map((issue) => ({
    in: "body" as const,
    path: (issue.path ?? []).map((p) => {
      const key = typeof p === "object" ? p.key : p;
      return typeof key === "number" ? key : String(key);
    }),
    message: issue.message,
  }));
  throw new HttpError(400, "Validation failed", { details: { issues } });
}

/** Whether a value is a Standard Schema. */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<StandardSchemaV1>)["~standard"]?.validate === "function"
  );
}

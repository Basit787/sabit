import { fileURLToPath } from "node:url";

/**
 * Frameworks `sabit init` can set up. Each has a starter project in
 * `templates/<id>/`, based on the framework's official starter with
 * file-based routing added. Edit those folders to change what users get.
 */
export interface Framework {
  readonly id: "express" | "hono" | "fastify" | "nest";
  readonly label: string;
}

export const FRAMEWORKS: readonly Framework[] = [
  { id: "express", label: "Express" },
  { id: "hono", label: "Hono" },
  { id: "fastify", label: "Fastify" },
  { id: "nest", label: "NestJS" },
];

export function findFramework(id: string): Framework | undefined {
  return FRAMEWORKS.find((f) => f.id === id || f.label.toLowerCase() === id.toLowerCase());
}

/** Absolute path of a framework's starter template (works from `src/` and `dist/`). */
export function templateDir(framework: Framework): string {
  return fileURLToPath(new URL(`../templates/${framework.id}/`, import.meta.url));
}

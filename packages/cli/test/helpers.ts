import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import type { Output } from "../src/index.ts";

const root = fileURLToPath(new URL("./.tmp", import.meta.url));
const created: string[] = [];

/*
 * A temporary directory inside this package, so generated route files can
 * resolve `@sabit/router` through the package's node_modules.
 */
export async function tempProject(): Promise<string> {
  await mkdir(root, { recursive: true });
  const dir = await mkdtemp(`${root}/project-`);
  created.push(dir);
  return dir;
}

afterAll(() => Promise.all(created.map((d) => rm(d, { recursive: true, force: true }))));

export function captureOutput(): Output & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, log: (m) => lines.push(m), error: (m) => errors.push(m) };
}

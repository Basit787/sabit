import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const bin = fileURLToPath(new URL("../src/index.ts", import.meta.url));

it("runs `sabit init` with the given arguments", () => {
  const result = spawnSync(process.execPath, ["--conditions=@sabit/source", bin, "--help"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toMatch(/^Usage: sabit init \[dir\] \[options\]/);
});

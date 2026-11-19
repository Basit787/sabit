import { describe, expect, it } from "vitest";
import { customRegistry } from "../src/commands/init.ts";

describe("customRegistry", () => {
  it("returns a custom registry from npm's environment", () => {
    expect(customRegistry({ npm_config_registry: "http://localhost:4873" })).toBe(
      "http://localhost:4873",
    );
    expect(customRegistry({ NPM_CONFIG_REGISTRY: "https://npm.corp.example/" })).toBe(
      "https://npm.corp.example/",
    );
  });

  it("ignores the public registries and empty values", () => {
    expect(customRegistry({ npm_config_registry: "https://registry.npmjs.org/" })).toBeUndefined();
    expect(customRegistry({ npm_config_registry: "https://registry.yarnpkg.com" })).toBeUndefined();
    expect(customRegistry({ npm_config_registry: " " })).toBeUndefined();
    expect(customRegistry({})).toBeUndefined();
  });
});

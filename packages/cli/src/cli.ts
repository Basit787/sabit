import { parseArgs } from "node:util";
import { RouteDefinitionError } from "@sabit/router";
import type { Command, Output } from "./command.ts";
import { commands } from "./commands/index.ts";
import { cliVersion } from "./project.ts";
import { UsageError } from "./scaffold.ts";

export interface RunOptions {
  readonly cwd?: string;
  readonly out?: Output;
  readonly interactive?: boolean;
}

const consoleOutput: Output = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

function mainHelp(): string {
  const width = Math.max(...commands.map((c) => c.name.length));
  return [
    "Usage: sabit <command> [options]",
    "",
    "Commands:",
    ...commands.map((c) => `  ${c.name.padEnd(width)}   ${c.summary}`),
    "",
    "Run `sabit <command> --help` for details.",
  ].join("\n");
}

function findCommand(name: string): Command | undefined {
  return commands.find((c) => c.name === name || c.aliases?.includes(name));
}

// Runs the CLI and resolves to the process exit code.
export async function run(argv: readonly string[], options: RunOptions = {}): Promise<number> {
  const out = options.out ?? consoleOutput;
  const [name, ...rest] = argv;

  if (name === undefined || name === "--help" || name === "-h" || name === "help") {
    out.log(mainHelp());
    return 0;
  }
  if (name === "--version" || name === "-v") {
    out.log(cliVersion());
    return 0;
  }

  const command = findCommand(name);
  if (!command) {
    out.error(`Unknown command "${name}".\n\n${mainHelp()}`);
    return 1;
  }
  if (rest.includes("--help") || rest.includes("-h")) {
    out.log(`Usage: ${command.usage}`);
    return 0;
  }

  try {
    const { values, positionals } = parseArgs({
      args: [...rest],
      options: command.options ?? {},
      allowPositionals: true,
      strict: true,
    });
    const code = await command.run({
      args: positionals,
      flags: values as Record<string, string | boolean | undefined>,
      cwd: options.cwd ?? process.cwd(),
      out,
      interactive: options.interactive ?? Boolean(process.stdin.isTTY),
    });
    return code ?? 0;
  } catch (error) {
    if (error instanceof RouteDefinitionError || error instanceof UsageError) {
      out.error(error.message);
      return 1;
    }
    if ((error as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      out.error(`${(error as Error).message}\n\nUsage: ${command.usage}`);
      return 1;
    }
    throw error;
  }
}

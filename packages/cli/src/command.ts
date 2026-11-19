import type { ParseArgsConfig } from "node:util";

export interface Output {
  log(message: string): void;
  error(message: string): void;
}

/*
 * What a command runs with: positional `args`, parsed `--flags`, the `cwd`, an `out` for messages, and
 * `interactive` (stdin is a terminal, so prompts are allowed).
 */
export interface CommandContext {
  readonly args: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
  readonly cwd: string;
  readonly out: Output;
  readonly interactive: boolean;
}

/*
 * A CLI command: add a module exporting one to the list in commands/index.ts. `summary` is its line in
 * `sabit --help`, `usage` its `--help`; `run` resolves to the exit code (long-running ones when they stop).
 */
export interface Command {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly summary: string;
  readonly usage: string;
  readonly options?: NonNullable<ParseArgsConfig["options"]>;
  run(ctx: CommandContext): Promise<number | undefined>;
}

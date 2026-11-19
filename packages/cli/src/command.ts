import type { ParseArgsConfig } from "node:util";

export interface Output {
  log(message: string): void;
  error(message: string): void;
}

export interface CommandContext {
  /** Positional arguments after the command name. */
  readonly args: readonly string[];
  /** Parsed `--flags`. */
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
  readonly cwd: string;
  readonly out: Output;
  /** Whether stdin is an interactive terminal (prompts are allowed). */
  readonly interactive: boolean;
}

/**
 * A CLI command. To add one, create a module that exports a `Command` and add
 * it to the list in `commands/index.ts`; nothing else needs to change.
 */
export interface Command {
  readonly name: string;
  readonly aliases?: readonly string[];
  /** One line for `sabit --help`. */
  readonly summary: string;
  /** Usage line(s) and details for `sabit <command> --help`. */
  readonly usage: string;
  readonly options?: NonNullable<ParseArgsConfig["options"]>;
  /** Resolves to an exit code (default 0). Long-running commands resolve when they stop. */
  run(ctx: CommandContext): Promise<number | undefined>;
}

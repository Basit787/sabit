import type { Command } from "../command.ts";
import { add } from "./add.ts";
import { dev } from "./dev.ts";
import { generate } from "./generate.ts";
import { init } from "./init.ts";
import { routes } from "./routes.ts";
import { watch } from "./watch.ts";

/** Every command, in help order. Add new commands here. */
export const commands: readonly Command[] = [init, dev, watch, add, generate, routes];

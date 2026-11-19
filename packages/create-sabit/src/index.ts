#!/usr/bin/env node
// `npm create sabit [dir]` (also pnpm/yarn/bun create) runs this: it's `sabit init`.
import { run } from "sabit";

process.exitCode = await run(["init", ...process.argv.slice(2)]);

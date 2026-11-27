import { join } from "node:path";
import { runNpmSmoke } from "./npm/npm-utils.ts";

if (import.meta.main) process.exit(runNpmSmoke(join(import.meta.dir, ".."), process.argv.slice(2)));

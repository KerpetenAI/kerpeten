import { join } from "node:path";
import { runNpmPackages } from "./npm/npm-utils.ts";

if (import.meta.main) process.exit(runNpmPackages(join(import.meta.dir, ".."), process.argv.slice(2)));

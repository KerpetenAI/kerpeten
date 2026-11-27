import { join } from "node:path";
import { runBuild } from "./build/build-utils.ts";

if (import.meta.main) process.exit(runBuild(join(import.meta.dir, ".."), process.argv.slice(2)));

import { runBlankLines } from "./check/check-utils.ts";

if (import.meta.main) process.exit(await runBlankLines(process.cwd(), process.argv.includes("--write")));

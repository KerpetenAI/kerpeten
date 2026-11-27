import { runLayout } from "./check/check-utils.ts";

if (import.meta.main) process.exit(await runLayout(process.cwd()));

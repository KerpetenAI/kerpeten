#!/usr/bin/env bun
import { join } from "node:path";

if (import.meta.main) {
  const root = join(import.meta.dir, "..");

  const cli = Bun.spawn(
    [
      process.execPath,
      `--tsconfig-override=${join(root, "tsconfig.json")}`,
      join(root, "src", "cli", "main.ts"),
      ...process.argv.slice(2),
    ],
    { stdin: "inherit", stdout: "inherit", stderr: "inherit" },
  );

  process.exit(await cli.exited);
}

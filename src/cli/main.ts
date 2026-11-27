#!/usr/bin/env bun
import { KerpetenApp } from "../app/KerpetenApp.ts";

if (import.meta.main) {
  const io = {
    out: (line: string) => process.stdout.write(`${line}\n`),
    err: (line: string) => process.stderr.write(`${line}\n`),
  };

  process.exit(await KerpetenApp.run({ io, env: process.env }, process.argv.slice(2)));
}

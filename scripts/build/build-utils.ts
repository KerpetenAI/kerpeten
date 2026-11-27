import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Targets } from "./Targets.ts";
import type { Target } from "./types/build.ts";

export function buildBinary(root: string, target: Target, outfile: string): void {
  const result = Bun.spawnSync(
    ["bun", "build", "--compile", `--target=bun-${target}`, join(root, "src", "cli", "main.ts"), "--outfile", outfile],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `bun build for ${target} failed: ${result.stderr.toString().trim() || result.stdout.toString().trim()}`,
    );
  }
}

export function runBuild(root: string, args: readonly string[]): number {
  const parsed = parseArgs({ args: [...args], options: { target: { type: "string", multiple: true } } });
  const wanted = parsed.values.target ?? [...Targets.ALL];

  mkdirSync(join(root, "dist"), { recursive: true });

  for (const target of wanted) {
    if (!Targets.is(target)) {
      console.error(`build: unknown target ${target}; expected one of ${Targets.ALL.join(", ")}`);

      return 2;
    }

    const outfile = join(root, "dist", `kerpeten-${target}`);

    buildBinary(root, target, outfile);
    console.log(`build: ${outfile}`);
  }

  return 0;
}

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Target } from "./types/build.ts";

const TARGETS: readonly Target[] = ["linux-x64", "linux-arm64", "darwin-arm64"];

function isTarget(value: string): value is Target {
  return (TARGETS as readonly string[]).includes(value);
}

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
  const wanted = parsed.values.target ?? [...TARGETS];

  mkdirSync(join(root, "dist"), { recursive: true });

  for (const target of wanted) {
    if (!isTarget(target)) {
      console.error(`build: unknown target ${target}; expected one of ${TARGETS.join(", ")}`);

      return 2;
    }

    const outfile = join(root, "dist", `kerpeten-${target}`);

    buildBinary(root, target, outfile);
    console.log(`build: ${outfile}`);
  }

  return 0;
}

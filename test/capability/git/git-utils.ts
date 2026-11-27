import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function sh(cwd: string, args: readonly string[]): string {
  const result = Bun.spawnSync(
    ["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );

  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);

  return result.stdout.toString().trim();
}

export function tempRepo(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  sh(dir, ["init", "-q", "-b", "main"]);

  return dir;
}

export function write(repo: string, files: Record<string, string | Uint8Array>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
}

export function commit(repo: string, message: string): string {
  sh(repo, ["add", "-A"]);
  sh(repo, ["commit", "-q", "--allow-empty", "-m", message]);

  return sh(repo, ["rev-parse", "HEAD"]);
}

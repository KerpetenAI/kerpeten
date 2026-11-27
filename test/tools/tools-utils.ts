import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Sandbox } from "./types/tools.ts";

export const SECRET = "OUTSIDE-SECRET-7f3a";
export const TOKEN = "glpat-INSIDE-GIT-CONFIG-91c2";

function put(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function sandbox(): Sandbox {
  const base = mkdtempSync(join(tmpdir(), "kerpeten-tools-"));
  const repo = join(base, "repo");
  const outside = join(base, "outside");

  put(join(outside, "secret.txt"), `${SECRET}\n`);
  put(join(base, "repo-evil", "secret.txt"), `${SECRET}\n`);
  put(join(repo, "src", "a.ts"), "export const a = 1;\nexport const needle = 2;\n");
  put(join(repo, "src", "b.ts"), "needle\n");
  put(join(repo, "docs", "readme.md"), "# docs\nneedle\n");
  put(join(repo, "bin.dat"), new Uint8Array([1, 0, 2, 3]));
  put(join(repo, ".github", "workflows", "ci.yml"), "on: push-marker\n");
  put(join(repo, ".gitlab-ci.yml"), "workflow: push-marker\n");
  put(join(repo, ".git", "config"), `[remote "origin"]\n  url = https://oauth2:${TOKEN}@gitlab.example/x.git\n`);
  put(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  symlinkSync(join(outside, "secret.txt"), join(repo, "out-file"));
  symlinkSync(outside, join(repo, "out-dir"));
  symlinkSync(join(repo, ".git", "config"), join(repo, "git-link"));
  symlinkSync(join(repo, ".git"), join(repo, "git-dir-link"));
  symlinkSync("src/a.ts", join(repo, "in-link.ts"));
  symlinkSync(join(base, "repo-evil"), join(repo, "evil-link"));

  return { base, repo, outside };
}

export function trackedPaths(repo: string): string[] {
  const paths: string[] = [];

  const walk = (dir: string, rel: string): void => {
    let names: string[];

    try {
      names = readdirSync(dir);
    } catch {
      return;
    }

    for (const name of names) {
      if (name.toLowerCase() === ".git") continue;

      const path = join(dir, name);
      const child = rel === "" ? name : `${rel}/${name}`;

      if (lstatSync(path).isDirectory()) walk(path, child);
      else paths.push(child);
    }
  };

  walk(repo, "");

  return paths.sort();
}

export function treeHash(dir: string): string {
  const hasher = new Bun.CryptoHasher("sha256");

  const walk = (path: string, rel: string): void => {
    const stat = lstatSync(path);

    hasher.update(`${rel}\0${stat.mode}\0${stat.size}\0${stat.mtimeMs}\0`);

    if (stat.isSymbolicLink()) {
      hasher.update(readlinkSync(path));
    } else if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name), `${rel}/${name}`);
    } else if (stat.isFile()) {
      hasher.update(readFileSync(path));
    }
  };

  walk(dir, "");

  return hasher.digest("hex");
}

export function fakeRg(dir: string, body: string): string {
  const path = join(dir, "fake-rg");

  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);

  return path;
}

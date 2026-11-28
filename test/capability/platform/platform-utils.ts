import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GhAnswer, GhPaths, PullFields } from "./types/platform.ts";

export const SHA_A = "a".repeat(40);
export const SHA_B = "b".repeat(40);
export const SHA_C = "c".repeat(40);

function quoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

/** The paths the platform asks gh for, word for word. */
export function ghPaths(number: number): GhPaths {
  return {
    pull: `repos/{owner}/{repo}/pulls/${number}`,
    comments: `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`,
    reviews: `repos/{owner}/{repo}/pulls/${number}/reviews?per_page=100`,
    conversation: `repos/{owner}/{repo}/issues/${number}/comments?per_page=100`,
  };
}

/**
 * Writes a script named `gh` into `dir` and returns its path. It appends the arguments of every call to `calls.txt`
 * and its working directory to `cwd.txt`, runs `before`, and answers by its last argument, the path, from `answers`;
 * a path it has no answer for ends with 97. It uses only what the shell has built in, so it needs no PATH.
 */
export function fakeGh(dir: string, answers: Readonly<Record<string, GhAnswer>>, before = ""): string {
  const cases = Object.entries(answers).map(([path, answer]) =>
    [
      `  ${quoted(path)})`,
      `    printf '%s' ${quoted(answer.stdout ?? "")}`,
      `    printf '%s' ${quoted(answer.stderr ?? "")} >&2`,
      `    exit ${answer.exitCode ?? 0} ;;`,
    ].join("\n"),
  );

  const script = [
    "#!/bin/sh",
    `(IFS='|'; printf '%s\\n' "$*") >> ${quoted(join(dir, "calls.txt"))}`,
    `printf '%s\\n' "$PWD" >> ${quoted(join(dir, "cwd.txt"))}`,
    before,
    'for last in "$@"; do :; done',
    'case "$last" in',
    ...cases,
    "  *)",
    "    printf 'the fake gh has no answer for: %s\\n' \"$*\" >&2",
    "    exit 97 ;;",
    "esac",
    "",
  ].join("\n");

  const path = join(dir, "gh");

  writeFileSync(path, script);
  chmodSync(path, 0o755);

  return path;
}

/** The arguments of every call the fake gh in `dir` got, in order. */
export function ghCalls(dir: string): string[][] {
  const path = join(dir, "calls.txt");

  if (!existsSync(path)) return [];

  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split("|"));
}

/** What `gh api --paginate --slurp` prints: one array whose elements are the pages. */
export function slurped(...pages: readonly (readonly unknown[])[]): string {
  return JSON.stringify(pages);
}

/** The answers of a pull request that has no comment of any kind: three lists of one empty page. */
export function noComments(number: number): Record<string, GhAnswer> {
  const paths = ghPaths(number);

  return {
    [paths.comments]: { stdout: slurped([]) },
    [paths.reviews]: { stdout: slurped([]) },
    [paths.conversation]: { stdout: slurped([]) },
  };
}

/** The JSON gh prints for a pull request. */
export function pullJson(fields: PullFields = {}): string {
  const number = fields.number ?? 12;

  return JSON.stringify({
    url: `https://api.github.com/repos/Acme/Shop/pulls/${number}`,
    html_url: fields.htmlUrl ?? `https://github.com/Acme/Shop/pull/${number}`,
    number,
    state: fields.state ?? "open",
    merged: fields.merged ?? false,
    title: fields.title ?? "Add div",
    body: fields.body === undefined ? "Adds a division helper." : fields.body,
    user: { login: "octocat" },
    head: { sha: fields.headSha ?? SHA_A, ref: "feature", repo: { id: 99 } },
    base: { sha: fields.baseSha ?? SHA_B, ref: "main", repo: { id: fields.repoId ?? 4242 } },
  });
}

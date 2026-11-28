import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CliAnswer,
  CliName,
  GhPaths,
  GlabPaths,
  MergeRequestFields,
  NoteFields,
  PositionFields,
  PullFields,
} from "./types/platform.ts";

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

/** The paths the platform asks glab for, word for word. */
export function glabPaths(number: number): GlabPaths {
  return {
    mergeRequest: `projects/:fullpath/merge_requests/${number}`,
    discussions: `projects/:fullpath/merge_requests/${number}/discussions?per_page=100`,
  };
}

/**
 * Writes a script named `name` into `dir` and returns its path. It appends the arguments of every call to
 * `<name>-calls.txt` and its working directory to `<name>-cwd.txt`, runs `before`, and answers by its last argument,
 * the path, from `answers`; a path it has no answer for ends with 97. It uses only what the shell has built in, so it
 * needs no PATH.
 */
export function fakeCli(dir: string, name: CliName, answers: Readonly<Record<string, CliAnswer>>, before = ""): string {
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
    `(IFS='|'; printf '%s\\n' "$*") >> ${quoted(join(dir, `${name}-calls.txt`))}`,
    `printf '%s\\n' "$PWD" >> ${quoted(join(dir, `${name}-cwd.txt`))}`,
    before,
    'for last in "$@"; do :; done',
    'case "$last" in',
    ...cases,
    "  *)",
    `    printf 'the fake ${name} has no answer for: %s\\n' "$*" >&2`,
    "    exit 97 ;;",
    "esac",
    "",
  ].join("\n");

  const path = join(dir, name);

  writeFileSync(path, script);
  chmodSync(path, 0o755);

  return path;
}

/** A fake gh in `dir`, see `fakeCli`. */
export function fakeGh(dir: string, answers: Readonly<Record<string, CliAnswer>>, before = ""): string {
  return fakeCli(dir, "gh", answers, before);
}

/** A fake glab in `dir`, see `fakeCli`. */
export function fakeGlab(dir: string, answers: Readonly<Record<string, CliAnswer>>, before = ""): string {
  return fakeCli(dir, "glab", answers, before);
}

/** The arguments of every call the fake `name` in `dir` got, in order. */
export function cliCalls(dir: string, name: CliName): string[][] {
  const path = join(dir, `${name}-calls.txt`);

  if (!existsSync(path)) return [];

  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .map((line) => line.split("|"));
}

/** The arguments of every call the fake gh in `dir` got, in order. */
export function ghCalls(dir: string): string[][] {
  return cliCalls(dir, "gh");
}

/** The arguments of every call the fake glab in `dir` got, in order. */
export function glabCalls(dir: string): string[][] {
  return cliCalls(dir, "glab");
}

/** The working directory of every call the fake `name` in `dir` got, in order. */
export function cliDirs(dir: string, name: CliName): string[] {
  return readFileSync(join(dir, `${name}-cwd.txt`), "utf8")
    .trim()
    .split("\n");
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

/** What `gh api --paginate --slurp` prints: one array whose elements are the pages. */
export function slurped(...pages: readonly (readonly unknown[])[]): string {
  return JSON.stringify(pages);
}

/** The JSON glab prints for a merge request, on one line as `--output ndjson` gives it. */
export function mergeRequestJson(fields: MergeRequestFields = {}): string {
  const iid = fields.iid ?? 12;
  const sha = fields.sha === undefined ? SHA_A : fields.sha;
  const baseSha = fields.baseSha === undefined ? SHA_B : fields.baseSha;

  const answer = {
    id: 576428090,
    iid,
    project_id: 4242,
    target_project_id: fields.projectId ?? 4242,
    source_project_id: 99,
    web_url: fields.webUrl ?? `https://gitlab.com/acme/shop/-/merge_requests/${iid}`,
    state: fields.state ?? "opened",
    title: fields.title ?? "Add div",
    description: fields.description === undefined ? "Adds a division helper." : fields.description,
    author: { username: "tanuki" },
    source_branch: "feature",
    target_branch: "main",
    sha,
    diff_refs: baseSha === null ? null : { base_sha: baseSha, head_sha: sha, start_sha: SHA_C },
  };

  return `${JSON.stringify(answer)}\n`;
}

/** What `glab api --paginate --output ndjson` prints: one entry per line, the pages one after another. */
export function jsonLines(...entries: readonly unknown[]): string {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

/** The position of a note in the diff as GitLab gives it: on line 7 of the new side of `src/a.ts` when nothing is set. */
export function position(fields: PositionFields = {}) {
  return {
    base_sha: SHA_B,
    start_sha: SHA_C,
    head_sha: SHA_A,
    old_path: "src/a.ts",
    new_path: "src/a.ts",
    position_type: "text",
    old_line: null,
    new_line: 7,
    line_range: null,
    ...fields,
  };
}

/** A note as GitLab gives it: a comment of ada without a position when nothing is set. */
export function note(id: number, fields: NoteFields = {}) {
  return {
    id,
    type: null,
    body: "y can be 0",
    author: { id: 1, username: "ada", name: "Ada" },
    created_at: "2026-11-20T10:00:00.000Z",
    updated_at: "2026-11-20T10:00:00.000Z",
    system: false,
    noteable_type: "MergeRequest",
    resolvable: false,
    ...fields,
  };
}

/** A discussion as GitLab gives it. */
export function discussion(id: string, ...notes: readonly unknown[]) {
  return { id, individual_note: notes.length === 1, notes };
}

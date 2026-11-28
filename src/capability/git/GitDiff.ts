import { Capability, CapabilityBase, Use } from "../../harness-kit/index.ts";
import { Git } from "./Git.ts";
import type { ChangedFile, ChangeStatus, DiffResult, PatchSection } from "./types/git.ts";

@Capability({
  name: "git-diff",
  description: "Builds the diff between two commits: the changed files, the ignore globs and the filtered patch.",
  scope: "run",
})
export class GitDiff extends CapabilityBase {
  private static readonly STATUS: Readonly<Record<string, ChangeStatus>> = {
    A: "added",
    M: "modified",
    D: "deleted",
    R: "renamed",
    C: "copied",
    T: "type_changed",
  };

  private static readonly HUNK = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

  private static readonly DIFF_OPTIONS: readonly string[] = [
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-relative",
    "--submodule=short",
    "--find-renames",
    "--unified=3",
    "--inter-hunk-context=0",
    "--src-prefix=a/",
    "--dst-prefix=b/",
  ];

  private static readonly ESCAPES: Readonly<Record<string, number>> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    "\\": 92,
  };

  private static readonly DIFF_HEADER = "diff --git ";

  @Use(Git)
  private readonly git!: Git;

  public async between(base: string, head: string, ignore: readonly string[] = []): Promise<DiffResult> {
    Git.assertRevision(base);
    Git.assertRevision(head);

    const names = await this.git.text([
      "diff",
      ...GitDiff.DIFF_OPTIONS,
      "--name-status",
      "-z",
      "--end-of-options",
      base,
      head,
      "--",
    ]);

    const fullPatch = await this.git.text(["diff", ...GitDiff.DIFF_OPTIONS, "--end-of-options", base, head, "--"]);
    const files = GitDiff.applyIgnore(GitDiff.parseNameStatus(names), ignore);
    const kept = new Set(files.map((file) => file.path));
    const patch = GitDiff.filterPatch(fullPatch, (path) => kept.has(path));

    GitDiff.assertComplete(patch);

    return { files, patch };
  }

  public static assertComplete(patch: string): void {
    let oldLeft = 0;
    let newLeft = 0;
    const lines = patch.split("\n");

    if (lines.at(-1) === "") lines.pop();

    for (const line of lines) {
      if (oldLeft > 0 || newLeft > 0) {
        const tag = line.charAt(0);

        if (tag === "\\") continue;

        if (tag === "+") newLeft--;
        else if (tag === "-") oldLeft--;
        else if (tag === " ") {
          oldLeft--;
          newLeft--;
        } else throw new Error(`unexpected line inside a hunk: ${JSON.stringify(line.slice(0, 80))}`);

        if (oldLeft < 0 || newLeft < 0) throw new Error("hunk is longer than its header says");

        continue;
      }

      if (!line.startsWith("@@ ")) continue;

      const match = GitDiff.HUNK.exec(line);

      if (match === null) throw new Error(`malformed hunk header ${line}`);

      oldLeft = match[1] === undefined ? 1 : Number(match[1]);
      newLeft = match[2] === undefined ? 1 : Number(match[2]);
    }

    if (oldLeft > 0 || newLeft > 0) throw new Error("diff ended inside a hunk");
  }

  public static parseNameStatus(output: string): ChangedFile[] {
    const fields = output.split("\0");

    if (fields.at(-1) === "") fields.pop();

    const files: ChangedFile[] = [];
    let i = 0;

    while (i < fields.length) {
      const code = fields[i] ?? "";
      const status = GitDiff.STATUS[code.charAt(0)];

      if (status === undefined) throw new Error(`unexpected git name-status entry ${JSON.stringify(code)}`);

      if (status === "renamed" || status === "copied") {
        const oldPath = fields[i + 1];
        const path = fields[i + 2];

        if (oldPath === undefined || path === undefined) throw new Error("truncated git name-status output");

        files.push({ status, path, oldPath });
        i += 3;
      } else {
        const path = fields[i + 1];

        if (path === undefined) throw new Error("truncated git name-status output");

        files.push({ status, path });
        i += 2;
      }
    }

    return files;
  }

  public static unquotePath(raw: string): string {
    if (!raw.startsWith('"')) return raw;
    if (!raw.endsWith('"') || raw.length < 2) throw new Error(`malformed quoted path ${raw}`);

    const bytes: number[] = [];
    const body = raw.slice(1, -1);

    for (let i = 0; i < body.length; i++) {
      const point = body.codePointAt(i) ?? 0;

      if (point !== 92) {
        bytes.push(...Buffer.from(String.fromCodePoint(point), "utf8"));

        if (point > 0xffff) i++;

        continue;
      }

      const next = body[i + 1] ?? "";

      if (/[0-7]/.test(next)) {
        bytes.push(Number.parseInt(body.slice(i + 1, i + 4), 8));
        i += 3;
      } else if (GitDiff.ESCAPES[next] !== undefined) {
        bytes.push(GitDiff.ESCAPES[next]);
        i += 1;
      } else {
        throw new Error(`malformed quoted path ${raw}`);
      }
    }

    return Buffer.from(bytes).toString("utf8");
  }

  public static applyIgnore(files: readonly ChangedFile[], globs: readonly string[]): ChangedFile[] {
    return files.filter((file) => !GitDiff.isIgnored(file.path, globs));
  }

  public static changedPaths(files: readonly ChangedFile[]): string[] {
    return [...new Set(files.map((file) => file.path))].sort();
  }

  public static filterPatch(patch: string, keep: (path: string) => boolean): string {
    const starts = GitDiff.sectionStarts(patch);

    if (starts.length === 0) return patch;

    let result = patch.slice(0, starts[0]);

    for (const section of GitDiff.sections(patch)) {
      if (keep(section.path)) result += section.text;
    }

    return result;
  }

  /**
   * The sections of a patch, one per file and in the patch's order, each with the path the patch gives its file: the
   * new path of a renamed file, the old path of a deleted one.
   */
  public static sections(patch: string): PatchSection[] {
    const starts = GitDiff.sectionStarts(patch);

    return starts.map((start, index) => {
      const text = patch.slice(start, starts[index + 1] ?? patch.length);

      return { path: GitDiff.sectionPath(text), text };
    });
  }

  private static sectionStarts(patch: string): number[] {
    const starts: number[] = [];

    if (patch.startsWith(GitDiff.DIFF_HEADER)) starts.push(0);

    let at = patch.indexOf(`\n${GitDiff.DIFF_HEADER}`);

    while (at >= 0) {
      starts.push(at + 1);
      at = patch.indexOf(`\n${GitDiff.DIFF_HEADER}`, at + 1);
    }

    return starts;
  }

  private static headerPath(line: string, marker: "--- " | "+++ ", prefix: "a/" | "b/"): string | undefined {
    const raw = line.slice(marker.length).replace(/\t$/, "");

    if (raw === "/dev/null") return undefined;

    const path = GitDiff.unquotePath(raw);

    if (!path.startsWith(prefix)) throw new Error(`unexpected diff header ${line}`);

    return path.slice(prefix.length);
  }

  private static headerLinePath(line: string): string | undefined {
    const names = line.slice(GitDiff.DIFF_HEADER.length);

    if (names.length % 2 === 0 || names.charAt((names.length - 1) / 2) !== " ") return undefined;

    const half = (names.length - 1) / 2;
    const before = GitDiff.unquotePath(names.slice(0, half));
    const after = GitDiff.unquotePath(names.slice(half + 1));

    if (!before.startsWith("a/") || !after.startsWith("b/") || before.slice(2) !== after.slice(2)) return undefined;

    return after.slice(2);
  }

  private static sectionPath(section: string): string {
    const lines = section.split("\n");
    let renamed: string | undefined;
    let added: string | undefined;
    let removed: string | undefined;

    for (const line of lines.slice(1)) {
      if (line.startsWith("@@ ") || line.startsWith("Binary files ")) break;

      if (line.startsWith("rename to ")) renamed = GitDiff.unquotePath(line.slice("rename to ".length));
      else if (line.startsWith("copy to ")) renamed = GitDiff.unquotePath(line.slice("copy to ".length));
      else if (line.startsWith("+++ ")) added = GitDiff.headerPath(line, "+++ ", "b/");
      else if (line.startsWith("--- ")) removed = GitDiff.headerPath(line, "--- ", "a/");
    }

    const path = renamed ?? added ?? removed ?? GitDiff.headerLinePath(lines[0] ?? "");

    if (path === undefined) throw new Error(`cannot tell the path of diff section ${lines[0] ?? ""}`);

    return path;
  }

  private static isIgnored(path: string, globs: readonly string[]): boolean {
    return globs.some((pattern) => new Bun.Glob(pattern).match(path));
  }
}

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, rmSync, symlinkSync } from "node:fs";
import { Git } from "../../../src/capability/git/Git.ts";
import { GitDiff } from "../../../src/capability/git/GitDiff.ts";
import { runComponent } from "../../app/app-utils.ts";
import { commit, sh, tempRepo, write } from "./git-utils.ts";

const git = (dir: string) => runComponent(Git, { repo: dir });

const diff = (dir: string) => runComponent(GitDiff, { repo: dir });

const lines = (n: number, tag = "line") => `${Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join("\n")}\n`;

let repo: string;
let base: string;
let head: string;
let mainTip: string;

beforeAll(() => {
  repo = tempRepo("kerpeten-git-");

  write(repo, {
    "src/a.ts": lines(30),
    "old name.ts": lines(10, "keep"),
    "gone.ts": "bye\n",
    "yarn.lock": "v1\n",
  });

  base = commit(repo, "base");
  sh(repo, ["checkout", "-q", "-b", "feature"]);

  const changed = lines(30).replace("line 5\n", "line 5 changed\nline 5b\n").replace("line 25\n", "");

  write(repo, {
    "src/a.ts": changed,
    'naïve "q".ts': "new\nfile\n",
    "bin.dat": new Uint8Array([0, 1, 2, 3]),
    "yarn.lock": "v2\n",
  });

  sh(repo, ["mv", "old name.ts", "new name.ts"]);
  rmSync(`${repo}/gone.ts`);
  head = commit(repo, "feature");
  sh(repo, ["checkout", "-q", "main"]);
  write(repo, { "other.ts": "x\n" });
  mainTip = commit(repo, "main moves on");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("refs", () => {
  test("merge-base is the fork point, not the target tip", async () => {
    expect(await (await git(repo)).mergeBase("main", "feature")).toBe(base);
    expect(await (await git(repo)).mergeBase(mainTip, head)).toBe(base);
  });

  test("resolves revisions to full commit ids", async () => {
    expect(await (await git(repo)).resolveCommit("feature")).toBe(head);
    expect(await (await git(repo)).resolveCommit(head.slice(0, 12))).toBe(head);
    await expect((await git(repo)).resolveCommit("no-such-branch")).rejects.toThrow();
  });

  test("refuses revisions that could be read as options or ranges", async () => {
    for (const bad of ["--output=/tmp/x", "-p", "a..b", "a b", "", "a\nb", "a;b"]) {
      expect(() => Git.assertRevision(bad)).toThrow();
    }

    await expect((await git(repo)).mergeBase("--all", "main")).rejects.toThrow();
  });

  test("reports unrelated histories", async () => {
    sh(repo, ["checkout", "-q", "--orphan", "lonely"]);
    sh(repo, ["rm", "-rq", "--cached", "."]);

    const lonely = commit(repo, "lonely");

    sh(repo, ["checkout", "-q", "-f", "main"]);
    await expect((await git(repo)).mergeBase(lonely, head)).rejects.toThrow("no common ancestor");
  });
});

describe("remotes", () => {
  test("gives the URL of the origin remote as git uses it, and none when the repository has no origin remote", async () => {
    const dir = tempRepo("kerpeten-git-remote-");

    try {
      expect(await (await git(dir)).originUrl()).toBeUndefined();

      sh(dir, ["remote", "add", "upstream", "https://gitlab.com/acme/shop.git"]);

      expect(await (await git(dir)).originUrl()).toBeUndefined();

      sh(dir, ["remote", "add", "origin", "work:acme/shop.git"]);

      expect(await (await git(dir)).originUrl()).toBe("work:acme/shop.git");

      sh(dir, ["config", "url.git@github.com:.insteadOf", "work:"]);

      expect(await (await git(dir)).originUrl()).toBe("git@github.com:acme/shop.git");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("diff", () => {
  test("lists every change with its status, renames and unusual names intact", async () => {
    const result = await (await diff(repo)).between(base, head);

    expect(result.files).toEqual([
      { status: "added", path: "bin.dat" },
      { status: "deleted", path: "gone.ts" },
      { status: "added", path: 'naïve "q".ts' },
      { status: "renamed", path: "new name.ts", oldPath: "old name.ts" },
      { status: "modified", path: "src/a.ts" },
      { status: "modified", path: "yarn.lock" },
    ]);
  });

  test("drops ignored files from the list and the patch", async () => {
    const result = await (await diff(repo)).between(base, head, ["**/*.lock", "*.lock", "**/*.dat"]);

    expect(GitDiff.changedPaths(result.files)).toEqual(["gone.ts", 'naïve "q".ts', "new name.ts", "src/a.ts"]);
    expect(result.patch).not.toContain("yarn.lock");
    expect(result.patch).not.toContain("bin.dat");
    expect(result.patch).toContain("rename from old name.ts");
    expect(result.patch).toContain("+++ b/src/a.ts");
    expect(result.patch).toContain("--- a/gone.ts");
    expect(result.patch).toContain('+++ "b/naïve \\"q\\".ts"');

    const full = await (await diff(repo)).between(base, head);

    expect(GitDiff.filterPatch(full.patch, (path) => GitDiff.changedPaths(full.files).includes(path))).toBe(full.patch);
    expect(GitDiff.filterPatch(full.patch, () => false)).toBe("");
    expect(full.patch).toContain("yarn.lock");
    expect(full.patch).toContain("Binary files /dev/null and b/bin.dat differ");
  });

  test("returns an empty patch when every file is ignored", async () => {
    const result = await (await diff(repo)).between(base, head, ["**"]);

    expect(result.files).toEqual([]);
    expect(result.patch).toBe("");
  });

  test("drops every section of an ignored type change, mode change or empty file", async () => {
    const other = tempRepo("kerpeten-git-kinds-");

    try {
      write(other, { "kind.gen": "x\n", "mode.gen": "m\n", "keep.ts": "k\n" });

      const from = commit(other, "base");

      rmSync(`${other}/kind.gen`);
      symlinkSync("keep.ts", `${other}/kind.gen`);
      chmodSync(`${other}/mode.gen`, 0o755);
      write(other, { "empty.gen": "", "keep.ts": "k2\n" });

      const to = commit(other, "kinds");
      const full = await (await diff(other)).between(from, to);

      expect(GitDiff.changedPaths(full.files)).toEqual(["empty.gen", "keep.ts", "kind.gen", "mode.gen"]);
      expect(full.patch.match(/^diff --git a\/kind\.gen/gm)?.length).toBe(2);

      expect(GitDiff.filterPatch(full.patch, (path) => GitDiff.changedPaths(full.files).includes(path))).toBe(
        full.patch,
      );

      expect(GitDiff.filterPatch(full.patch, () => false)).toBe("");

      const result = await (await diff(other)).between(from, to, ["*.gen"]);

      expect(GitDiff.changedPaths(result.files)).toEqual(["keep.ts"]);
      expect(result.patch.startsWith("diff --git a/keep.ts b/keep.ts\n")).toBe(true);
      expect(result.patch).not.toContain(".gen");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("reads a blank context line when diff.suppressBlankEmpty is set", async () => {
    const other = tempRepo("kerpeten-git-blank-");

    try {
      write(other, { "x.txt": "a\n\nb\n" });

      const from = commit(other, "base");

      write(other, { "x.txt": "a\n\nc\n" });

      const to = commit(other, "change");

      sh(other, ["config", "diff.suppressBlankEmpty", "true"]);

      const result = await (await diff(other)).between(from, to);

      expect(result.patch).toContain("@@ -1,3 +1,3 @@\n a\n \n-b\n+c\n");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("keeps an ignored submodule out of the patch when diff.submodule is log", async () => {
    const other = tempRepo("kerpeten-git-submodule-");

    const snapshot = (text: string, gitlink: string): string => {
      write(other, { "a.ts": text });
      sh(other, ["add", "a.ts"]);
      sh(other, ["update-index", "--add", "--cacheinfo", `160000,${gitlink},vendor/x`]);
      sh(other, ["commit", "-q", "-m", text]);

      return sh(other, ["rev-parse", "HEAD"]);
    };

    try {
      const from = snapshot("one\n", "1".repeat(40));
      const to = snapshot("two\n", "2".repeat(40));

      sh(other, ["config", "diff.submodule", "log"]);

      const result = await (await diff(other)).between(from, to, ["vendor/**"]);

      expect(result.files.map((file) => file.path)).toEqual(["a.ts"]);
      expect(result.patch).not.toContain("vendor/x");
      expect(result.patch).not.toContain("Submodule");
      expect(result.patch.startsWith("diff --git a/a.ts b/a.ts\n")).toBe(true);

      const only = await (await diff(other)).between(from, to, ["vendor/**", "a.ts"]);

      expect(only.patch).toBe("");
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("keeps the patch section of a quoted path with a character outside the BMP", async () => {
    const other = tempRepo("kerpeten-git-astral-");

    try {
      const start = commit(other, "start");

      write(other, { 'emoji 😀 "q".ts': "one\ntwo\n" });

      const end = commit(other, "emoji");
      const result = await (await diff(other)).between(start, end);

      expect(GitDiff.changedPaths(result.files)).toEqual(['emoji 😀 "q".ts']);
      expect(result.patch).toContain('+++ "b/emoji 😀 \\"q\\".ts"');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("ignores user diff settings that would change the output", async () => {
    const expected = (await (await diff(repo)).between(base, head)).patch;

    sh(repo, ["config", "diff.noprefix", "true"]);
    sh(repo, ["config", "diff.mnemonicPrefix", "true"]);
    sh(repo, ["config", "core.quotepath", "true"]);
    sh(repo, ["config", "diff.context", "10"]);
    sh(repo, ["config", "color.diff", "always"]);
    sh(repo, ["config", "diff.suppressBlankEmpty", "true"]);

    try {
      const result = await (await diff(repo)).between(base, head);

      expect(result.patch).toBe(expected);
    } finally {
      for (const key of [
        "diff.noprefix",
        "diff.mnemonicPrefix",
        "core.quotepath",
        "diff.context",
        "color.diff",
        "diff.suppressBlankEmpty",
      ]) {
        sh(repo, ["config", "--unset", key]);
      }
    }
  });
});

describe("environment", () => {
  test("git runs with the caller's environment, so HOME reaches its child processes", async () => {
    const home = Bun.env.HOME ?? "";
    const result = await (await git(repo)).run(["-c", 'alias.home=!printf %s "$HOME"', "home"]);

    expect(home).not.toBe("");

    expect({ exitCode: result.exitCode, stdout: result.stdout.toString("utf8") }).toEqual({
      exitCode: 0,
      stdout: home,
    });
  });
});

describe("diff parsing", () => {
  test("refuses a truncated or malformed hunk", () => {
    expect(() => GitDiff.assertComplete("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n")).toThrow(
      "diff ended inside a hunk",
    );

    expect(() => GitDiff.assertComplete("@@ -1,2 +1,2 @@\n a\nX\n")).toThrow("unexpected line inside a hunk");
    expect(() => GitDiff.assertComplete("@@ -1,x +1 @@\n")).toThrow("malformed hunk header");
    expect(() => GitDiff.assertComplete("@@ -1,2 +1,2 @@\n a\n-b\n+c\n\\ No newline at end of file\n")).not.toThrow();
    expect(() => GitDiff.assertComplete("")).not.toThrow();
  });

  test("unquotes C-style quoted paths", () => {
    expect(GitDiff.unquotePath('"b/na\\303\\257ve \\"q\\".ts"')).toBe('b/naïve "q".ts');
    expect(GitDiff.unquotePath('"b/tab\\there"')).toBe("b/tab\there");
    expect(GitDiff.unquotePath("b/plain")).toBe("b/plain");
    expect(() => GitDiff.unquotePath('"b/bad\\x"')).toThrow();
  });

  test("keeps a character outside the BMP intact in a quoted path", () => {
    expect(GitDiff.unquotePath('"b/\\"q\\" 😀.ts"')).toBe('b/"q" 😀.ts');
    expect(GitDiff.unquotePath('"b/😀\\t\\360\\237\\230\\200"')).toBe("b/😀\t😀");
  });

  test("parses name-status records including renames", () => {
    expect(GitDiff.parseNameStatus("M\0a\0R087\0b\0c\0D\0d\0")).toEqual([
      { status: "modified", path: "a" },
      { status: "renamed", path: "c", oldPath: "b" },
      { status: "deleted", path: "d" },
    ]);

    expect(() => GitDiff.parseNameStatus("X\0a\0")).toThrow();
    expect(() => GitDiff.parseNameStatus("R100\0a\0")).toThrow();
  });

  test("the default ignore globs also match files at the repository root", () => {
    const files = [
      { status: "modified" as const, path: "bun.lock" },
      { status: "added" as const, path: "generated/x.ts" },
      { status: "modified" as const, path: "src/keep.ts" },
    ];

    expect(GitDiff.applyIgnore(files, ["**/*.lock", "**/generated/**"]).map((f) => f.path)).toEqual(["src/keep.ts"]);
  });

  test("ignore globs match repo-relative paths", () => {
    const files = [
      { status: "modified" as const, path: "a/b/generated/x.ts" },
      { status: "modified" as const, path: "a/bun.lock" },
      { status: "modified" as const, path: "src/keep.ts" },
    ];

    expect(GitDiff.applyIgnore(files, ["**/*.lock", "**/generated/**"]).map((f) => f.path)).toEqual(["src/keep.ts"]);
    expect(GitDiff.applyIgnore(files, []).length).toBe(3);
  });
});

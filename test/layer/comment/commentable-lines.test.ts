import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { GitDiff } from "../../../src/capability/git/GitDiff.ts";
import { CommentableLines } from "../../../src/layer/comment/CommentableLines.ts";
import { runComponent } from "../../app/app-utils.ts";
import { commit, sh, tempRepo, write } from "../../capability/git/git-utils.ts";
import { PATCH } from "./comment-utils.ts";

const dirs: string[] = [];

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function numbered(count: number, tag = "line"): string {
  return `${Array.from({ length: count }, (_, index) => `${tag} ${index + 1}`).join("\n")}\n`;
}

describe("the lines a comment can sit on", () => {
  const lines = CommentableLines.of(PATCH);

  test("every new line of a hunk counts, a changed line and a context line alike", () => {
    expect(lines.holds("src/a.ts", 6, 6)).toBe(true);
    expect(lines.holds("src/a.ts", 4, 4)).toBe(true);
    expect(lines.holds("src/a.ts", 3, 9)).toBe(true);
    expect(lines.holds("src/a.ts", 20, 26)).toBe(true);
  });

  test("a range is held up to the first and the last line of its hunk and not one line further", () => {
    expect(lines.holds("src/a.ts", 3, 3)).toBe(true);
    expect(lines.holds("src/a.ts", 9, 9)).toBe(true);
    expect(lines.holds("src/a.ts", 2, 3)).toBe(false);
    expect(lines.holds("src/a.ts", 9, 10)).toBe(false);
    expect(lines.holds("src/a.ts", 19, 20)).toBe(false);
    expect(lines.holds("src/a.ts", 26, 27)).toBe(false);
    expect(lines.holds("src/a.ts", 1, 1)).toBe(false);
    expect(lines.holds("src/a.ts", 12, 14)).toBe(false);
  });

  test("a range across two hunks is not held, though each end lies in a hunk", () => {
    expect(lines.holds("src/a.ts", 8, 21)).toBe(false);
    expect(lines.holds("src/a.ts", 3, 26)).toBe(false);
  });

  test("a range whose end is before its start is not held", () => {
    expect(lines.holds("src/a.ts", 6, 5)).toBe(false);
  });

  test("a renamed file is known by its new path only", () => {
    expect(lines.holds("src/new name.ts", 1, 4)).toBe(true);
    expect(lines.holds("src/new name.ts", 5, 5)).toBe(false);
    expect(lines.holds("src/old name.ts", 1, 1)).toBe(false);
  });

  test("an added file holds all its lines, also when its last line has no line end", () => {
    expect(lines.holds("src/added.ts", 1, 2)).toBe(true);
    expect(lines.holds("src/added.ts", 3, 3)).toBe(false);
  });

  test("a deleted file has no new side and holds nothing", () => {
    expect(lines.holds("src/gone.ts", 1, 1)).toBe(false);
    expect(lines.holds("src/gone.ts", 1, 2)).toBe(false);
  });

  test("a path git quotes is read back as the real path", () => {
    expect(lines.holds('src/naïve "q".ts', 1, 2)).toBe(true);
    expect(lines.holds('"src/na\\303\\257ve \\"q\\".ts"', 1, 2)).toBe(false);
  });

  test("a file that was only renamed and a file that is not in the patch hold nothing", () => {
    expect(lines.holds("moved-here.ts", 1, 1)).toBe(false);
    expect(lines.holds("src/untouched.ts", 1, 1)).toBe(false);
    expect(CommentableLines.of("").holds("src/a.ts", 1, 1)).toBe(false);
  });

  test("a hunk that only removes lines adds no line", () => {
    const removal = [
      "diff --git a/x.ts b/x.ts",
      "index 1111111..2222222 100644",
      "--- a/x.ts",
      "+++ b/x.ts",
      "@@ -5,2 +4,0 @@",
      "-five",
      "-six",
      "@@ -9 +7 @@",
      "-nine",
      "+nine changed",
      "",
    ].join("\n");

    const removed = CommentableLines.of(removal);

    expect(removed.holds("x.ts", 4, 4)).toBe(false);
    expect(removed.holds("x.ts", 5, 5)).toBe(false);
    expect(removed.holds("x.ts", 7, 7)).toBe(true);
    expect(removed.holds("x.ts", 8, 8)).toBe(false);
  });

  test("a line of a hunk that looks like a header of a patch is a line of the hunk", () => {
    const tricky = [
      "diff --git a/notes.md b/notes.md",
      "index 1111111..2222222 100644",
      "--- a/notes.md",
      "+++ b/notes.md",
      "@@ -1,2 +1,3 @@",
      " first",
      "+++ b/other.md",
      "--- a/first-old",
      "+@@ -1 +50,9 @@",
      "",
    ].join("\n");

    const read = CommentableLines.of(tricky);

    expect(read.holds("notes.md", 1, 3)).toBe(true);
    expect(read.holds("notes.md", 50, 50)).toBe(false);
    expect(read.holds("other.md", 1, 1)).toBe(false);
  });

  test("a patch that is not whole is refused", () => {
    const head = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n";

    expect(() => CommentableLines.of(`${head}@@ -1,2 +1,3 @@\n one\n`)).toThrow("diff ended inside a hunk");
    expect(() => CommentableLines.of(`${head}@@ nonsense @@\n`)).toThrow("malformed hunk header");
    expect(() => CommentableLines.of(`${head}@@ -1,2 +1,2 @@\n one\nstray\n`)).toThrow("unexpected line inside a hunk");
  });

  test("reads the patch git makes: two hunks, a rename, an added, a deleted and a quoted file, a file without a last line end", async () => {
    const repo = tempRepo("kerpeten-comment-lines-");

    dirs.push(repo);

    write(repo, {
      "src/a.ts": numbered(40),
      "old name.ts": numbered(10, "keep"),
      "gone.ts": "bye\n",
      "tail.ts": "one\ntwo",
    });

    const base = commit(repo, "base");

    sh(repo, ["mv", "old name.ts", "new name.ts"]);

    write(repo, {
      "src/a.ts": numbered(40)
        .replace("line 5\n", "line 5 changed\nline 5b\n")
        .replace("line 30\n", "line 30 changed\n"),
      "new name.ts": numbered(10, "keep").replace("keep 9\n", "keep 9 changed\n"),
      'naïve "q".ts': "new\nfile\n",
      "tail.ts": "one\ntwo\nthree",
    });

    sh(repo, ["rm", "-q", "gone.ts"]);

    const head = commit(repo, "change");
    const diff = await runComponent(GitDiff, { repo });
    const read = CommentableLines.of((await diff.between(base, head)).patch);

    expect(read.holds("src/a.ts", 2, 9)).toBe(true);
    expect(read.holds("src/a.ts", 1, 2)).toBe(false);
    expect(read.holds("src/a.ts", 9, 10)).toBe(false);
    expect(read.holds("src/a.ts", 28, 34)).toBe(true);
    expect(read.holds("src/a.ts", 27, 28)).toBe(false);
    expect(read.holds("src/a.ts", 34, 35)).toBe(false);
    expect(read.holds("src/a.ts", 6, 31)).toBe(false);
    expect(read.holds("new name.ts", 6, 10)).toBe(true);
    expect(read.holds("old name.ts", 6, 10)).toBe(false);
    expect(read.holds('naïve "q".ts', 1, 2)).toBe(true);
    expect(read.holds('naïve "q".ts', 1, 3)).toBe(false);
    expect(read.holds("gone.ts", 1, 1)).toBe(false);
    expect(read.holds("tail.ts", 1, 3)).toBe(true);
    expect(read.holds("tail.ts", 4, 4)).toBe(false);
  });
});

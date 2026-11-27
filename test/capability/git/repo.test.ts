import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KerpetenApp } from "../../../src/app/KerpetenApp.ts";
import { Git } from "../../../src/capability/git/Git.ts";
import { GitRoot } from "../../../src/capability/git/GitRoot.ts";
import { runComponent } from "../../app/app-utils.ts";
import { commit, sh, tempRepo, write } from "./git-utils.ts";

const git = (dir: string) => runComponent(Git, { repo: dir });

async function root(cwd: string): Promise<string> {
  const { app } = await KerpetenApp.start(
    { io: { out: () => {}, err: () => {} }, env: {}, cwd },
    KerpetenApp.COMPONENTS,
  );

  return (await app.resolve(GitRoot)).root();
}

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): { dir: string; base: string; head: string } {
  const dir = tempRepo("kerpeten-repo-");

  dirs.push(dir);
  write(dir, { "src/a b ü.ts": "one\n", "src/x.ts": "x\n" });

  const base = commit(dir, "base");

  write(dir, { "src/x.ts": "changed\n" });

  const head = commit(dir, "second\n\nbody line");

  return { dir, base, head };
}

describe("repository helpers", () => {
  test("lists the files of a commit, not the work tree", async () => {
    const { dir, base, head } = repo();

    write(dir, { ".gitignore": ".env\n", ".env": "secret\n", "new.ts": "untracked\n" });
    expect(await (await git(dir)).trackedFiles(head)).toEqual(["src/a b ü.ts", "src/x.ts"]);

    const third = commit(dir, "third");

    expect(await (await git(dir)).trackedFiles(third)).toEqual([".gitignore", "new.ts", "src/a b ü.ts", "src/x.ts"]);
    expect(await (await git(dir)).trackedFiles(base)).toEqual(["src/a b ü.ts", "src/x.ts"]);
    await expect((await git(dir)).trackedFiles("HEAD")).rejects.toThrow("commit id");
  });

  test("reads a blob at a commit, and nothing for a missing path, a directory or a bad path", async () => {
    const { dir, base, head } = repo();

    expect(await (await git(dir)).readBlob(head, "src/a b ü.ts", 1024)).toEqual({
      kind: "blob",
      bytes: Buffer.from("one\n"),
    });

    expect(await (await git(dir)).readBlob(base, "src/x.ts", 1024)).toEqual({
      kind: "blob",
      bytes: Buffer.from("x\n"),
    });

    for (const path of ["src/missing.ts", "src", "", "a\nb"]) {
      expect(await (await git(dir)).readBlob(head, path, 1024)).toEqual({ kind: "missing" });
    }

    await expect((await git(dir)).readBlob("HEAD", "src/x.ts", 1024)).rejects.toThrow("commit id");
  });

  test("a blob over the size cap reads as too large, not as missing", async () => {
    const { dir, head } = repo();

    expect(await (await git(dir)).readBlob(head, "src/x.ts", 8)).toEqual({
      kind: "blob",
      bytes: Buffer.from("changed\n"),
    });

    expect(await (await git(dir)).readBlob(head, "src/x.ts", 7)).toEqual({ kind: "too_large" });
  });

  test("checks for local changes without writing the index", async () => {
    const { dir } = repo();
    const index = join(dir, ".git", "index");
    const later = new Date(Date.now() + 60_000);

    utimesSync(join(dir, "src/x.ts"), later, later);

    const before = { bytes: readFileSync(index), mtime: statSync(index).mtimeMs };

    expect(await (await git(dir)).changedTrackedFiles()).toEqual([]);
    expect({ bytes: readFileSync(index), mtime: statSync(index).mtimeMs }).toEqual(before);
  });

  test("commit messages stop at the max count, newest first", async () => {
    const { dir, base } = repo();

    for (const n of [3, 4, 5]) {
      write(dir, { "src/x.ts": `${n}\n` });
      commit(dir, `commit ${n}`);
    }

    const head = sh(dir, ["rev-parse", "HEAD"]);

    expect(await (await git(dir)).commitMessages(base, head, 2)).toBe("commit 5\n\ncommit 4");

    expect(await (await git(dir)).commitMessages(base, head)).toBe(
      "commit 5\n\ncommit 4\n\ncommit 3\n\nsecond\n\nbody line",
    );
  });

  test("finds the root, the branch, the messages and the changed tracked files", async () => {
    const { dir, base, head } = repo();

    expect(await root(join(dir, "src"))).toBe(sh(dir, ["rev-parse", "--show-toplevel"]));
    expect(await (await git(dir)).currentBranch()).toBe("main");
    expect(await (await git(dir)).commitMessages(base, head)).toBe("second\n\nbody line");
    expect(await (await git(dir)).changedTrackedFiles()).toEqual([]);
    writeFileSync(join(dir, "notes.txt"), "untracked\n");
    expect(await (await git(dir)).changedTrackedFiles()).toEqual([]);
    sh(dir, ["add", "notes.txt"]);
    expect(await (await git(dir)).changedTrackedFiles()).toEqual([]);
    sh(dir, ["rm", "-q", "--cached", "notes.txt"]);
    sh(dir, ["add", "-N", "notes.txt"]);
    expect(await (await git(dir)).changedTrackedFiles()).toEqual([]);
    sh(dir, ["rm", "-q", "--cached", "notes.txt"]);
    rmSync(join(dir, "notes.txt"));
    writeFileSync(join(dir, "src/x.ts"), "dirty\n");
    rmSync(join(dir, "src/a b ü.ts"));
    expect(await (await git(dir)).changedTrackedFiles()).toEqual(["src/a b ü.ts", "src/x.ts"]);
    sh(dir, ["add", "src/x.ts"]);
    expect(await (await git(dir)).changedTrackedFiles()).toEqual(["src/a b ü.ts", "src/x.ts"]);
    sh(dir, ["checkout", "-q", "HEAD", "--", "."]);
    expect(await (await git(dir)).defaultRemoteBranch()).toBeUndefined();
    sh(dir, ["update-ref", "refs/remotes/origin/trunk", head]);
    sh(dir, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"]);
    expect(await (await git(dir)).defaultRemoteBranch()).toBe("origin/trunk");
    sh(dir, ["checkout", "-q", "--detach"]);
    expect(await (await git(dir)).currentBranch()).toBeUndefined();
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProcessCapability } from "@kerpetensh/harness-kit";
import { KerpetenApp } from "../../../src/app/KerpetenApp.ts";
import { Git } from "../../../src/capability/git/Git.ts";
import { GitRoot } from "../../../src/capability/git/GitRoot.ts";
import { GitTimeoutError } from "../../../src/capability/git/GitTimeoutError.ts";
import { runComponent } from "../../app/app-utils.ts";
import { StuckGit } from "./StuckGit.ts";
import { StuckGitRoot } from "./StuckGitRoot.ts";

const STUCK = "#!/bin/sh\nexec /bin/sleep 30\n";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A new folder with a program that never ends in it, under the name `program`. */
function stuck(program: string): string {
  const dir = mkdtempSync(join(tmpdir(), "kerpeten-stuck-git-"));

  dirs.push(dir);
  writeFileSync(join(dir, program), STUCK, { mode: 0o755 });

  return dir;
}

async function failure(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }

  throw new Error("it did not fail");
}

describe("the time limit of git", () => {
  test("a read of git gets two minutes, which is inside the longest a started program may run", () => {
    expect(Git.READ_MS).toBe(120_000);
    expect(Git.READ_MS).toBeLessThanOrEqual(ProcessCapability.MAX_RUN_MS);
  });

  test("a git command that does not finish is stopped and fails with an error that names the command and the limit", async () => {
    const git = await runComponent(
      StuckGit,
      { repo: stuck(StuckGit.PROGRAM) },
      { components: [...KerpetenApp.COMPONENTS.filter((component) => component !== Git), StuckGit] },
    );

    const started = Date.now();
    const error = await failure(git.outputText(["log", "--format=%B", "secret-branch-name"]));

    expect(error).toBeInstanceOf(GitTimeoutError);
    expect(error).toMatchObject({ name: "GitTimeoutError", timeoutMs: 200 });
    expect((error as Error).message).toBe("git log did not finish within 0.2 s and was stopped");
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(await failure(git.run(["status"]))).toBeInstanceOf(GitTimeoutError);
  }, 10_000);

  test("finding the repository fails the same way when git does not finish", async () => {
    const dir = stuck("git");

    const { app } = await KerpetenApp.start({ io: { out: () => {}, err: () => {} }, env: {}, cwd: dir }, [
      ...KerpetenApp.COMPONENTS.filter((component) => component !== GitRoot),
      StuckGitRoot,
    ]);

    const error = await failure((await app.resolve(StuckGitRoot)).root());

    expect(error).toBeInstanceOf(GitTimeoutError);
    expect((error as Error).message).toBe("git rev-parse did not finish within 0.2 s and was stopped");
  }, 10_000);
});

import {
  Capability,
  ProcessCapability,
  type ProcessSettings,
  ProcessTimeoutError,
  RunValue,
} from "@kerpetensh/harness-kit";
import { GitError } from "./GitError.ts";
import { GitTimeoutError } from "./GitTimeoutError.ts";
import type { BlobResult, GitResult } from "./types/git.ts";

@Capability({
  name: "git",
  description:
    "Runs git in the repository: resolves revisions, finds the merge base, lists the tracked files, reads commits and blobs and the URL of the origin remote.",
  scope: "run",
})
export class Git extends ProcessCapability {
  public static readonly FIXED_OPTIONS: readonly string[] = [
    "--no-optional-locks",
    "-c",
    "core.quotepath=false",
    "-c",
    "color.ui=never",
    "-c",
    "core.pager=cat",
    "-c",
    "diff.suppressBlankEmpty=false",
  ];

  /**
   * The longest one git command may take. Every command Kerpeten runs reads the local repository, which two minutes
   * cover many times over; a git that takes longer is stuck, and the user hears of it sooner than after the five
   * minutes a started program gets at most.
   */
  public static readonly READ_MS = 120_000;

  private static readonly REV = /^[A-Za-z0-9][A-Za-z0-9._/@{}^~+-]*$/;

  private static readonly SHA = /^[0-9a-f]{40}$/;

  private static readonly NEW_IN_INDEX = /^(A[ MD]| A) /;

  private static readonly NO_SUCH_REMOTE_EXIT = 2;

  @RunValue("repo")
  private readonly repo!: string;

  public static isSha(value: string): boolean {
    return Git.SHA.test(value);
  }

  public static assertRevision(value: string): void {
    if (!Git.REV.test(value) || value.includes("..") || value.length > 255) {
      throw new Error(`not an acceptable revision: ${JSON.stringify(value)}`);
    }
  }

  protected processSettings(): ProcessSettings {
    return { command: "git", fixedArgs: Git.FIXED_OPTIONS, cwd: this.repo, env: "inherit" };
  }

  /** The time one git command gets; a test gives a shorter one. */
  protected readMs(): number {
    return Git.READ_MS;
  }

  /**
   * Runs git with `args` to its end. A git that does not finish within `readMs` is stopped and a `GitTimeoutError`
   * is thrown.
   */
  public async run(args: readonly string[]): Promise<GitResult> {
    const ms = this.readMs();

    try {
      return await this.collect(args, ms);
    } catch (error) {
      if (error instanceof ProcessTimeoutError) throw new GitTimeoutError(args, ms);

      throw error;
    }
  }

  public async output(args: readonly string[]): Promise<Buffer> {
    const result = await this.run(args);

    if (result.exitCode !== 0) throw new GitError(args, result.exitCode, result.stderr);

    return result.stdout;
  }

  public async outputText(args: readonly string[]): Promise<string> {
    return (await this.output(args)).toString("utf8");
  }

  public async resolveCommit(rev: string): Promise<string> {
    Git.assertRevision(rev);

    const out = (
      await this.outputText(["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`])
    ).trim();

    if (!Git.isSha(out)) throw new Error(`${rev} does not resolve to a commit`);

    return out;
  }

  /** Whether the commit `sha` is in the repository; nothing is fetched. */
  public async hasCommit(sha: string): Promise<boolean> {
    if (!Git.isSha(sha)) throw new Error("hasCommit takes a commit id");

    const args = ["rev-parse", "--verify", "--quiet", "--end-of-options", `${sha}^{commit}`];
    const result = await this.run(args);

    if (result.exitCode !== 0 && result.exitCode !== 1) throw new GitError(args, result.exitCode, result.stderr);

    return result.exitCode === 0;
  }

  public async mergeBase(a: string, b: string): Promise<string> {
    Git.assertRevision(a);
    Git.assertRevision(b);

    const result = await this.run(["merge-base", "--end-of-options", a, b]);

    if (result.exitCode === 1) throw new Error(`${a} and ${b} have no common ancestor`);
    if (result.exitCode !== 0) throw new GitError(["merge-base"], result.exitCode, result.stderr);

    const sha = result.stdout.toString("utf8").trim();

    if (!Git.isSha(sha)) throw new Error(`merge-base of ${a} and ${b} is not one commit`);

    return sha;
  }

  public async defaultRemoteBranch(): Promise<string | undefined> {
    const result = await this.run(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);

    if (result.exitCode !== 0) return undefined;

    const ref = result.stdout.toString("utf8").trim();
    const prefix = "refs/remotes/";

    if (!ref.startsWith(prefix)) return undefined;

    const name = ref.slice(prefix.length);

    try {
      Git.assertRevision(name);
    } catch {
      return undefined;
    }

    return name;
  }

  /**
   * The URL of the remote `origin` as git uses it, with the `insteadOf` rewrites of the configuration applied, or
   * `undefined` when the repository has no such remote. The URL is outside data and may hold a password.
   */
  public async originUrl(): Promise<string | undefined> {
    const args = ["remote", "get-url", "origin"];
    const result = await this.run(args);

    if (result.exitCode === Git.NO_SUCH_REMOTE_EXIT) return undefined;
    if (result.exitCode !== 0) throw new GitError(args, result.exitCode, result.stderr);

    return result.stdout.toString("utf8").trim();
  }

  public async currentBranch(): Promise<string | undefined> {
    const result = await this.run(["symbolic-ref", "--quiet", "--short", "HEAD"]);

    return result.exitCode === 0 ? result.stdout.toString("utf8").trim() : undefined;
  }

  public async commitMessages(base: string, head: string, max = 50): Promise<string> {
    if (!Git.isSha(base) || !Git.isSha(head)) throw new Error("commitMessages takes commit ids");

    const out = await this.outputText([
      "log",
      `--max-count=${max}`,
      "--format=%B%x00",
      "--end-of-options",
      head,
      `^${base}`,
      "--",
    ]);

    return out
      .split("\0")
      .map((message) => message.trim())
      .filter((message) => message !== "")
      .join("\n\n");
  }

  public async changedTrackedFiles(): Promise<string[]> {
    const out = await this.outputText([
      "status",
      "--porcelain=v1",
      "-z",
      "--no-renames",
      "--untracked-files=no",
      "--ignore-submodules=all",
    ]);

    return out
      .split("\0")
      .filter((entry) => entry.length > 3 && !Git.NEW_IN_INDEX.test(entry))
      .map((entry) => entry.slice(3))
      .sort();
  }

  public async trackedFiles(commit: string): Promise<string[]> {
    if (!Git.isSha(commit)) throw new Error("trackedFiles takes a commit id");

    const out = await this.outputText(["ls-tree", "-r", "-z", "--full-tree", "--end-of-options", commit]);
    const files: string[] = [];

    for (const record of out.split("\0")) {
      const tab = record.indexOf("\t");

      if (tab < 0) continue;
      if (record.slice(0, tab).split(" ")[1] === "blob") files.push(record.slice(tab + 1));
    }

    return files.sort();
  }

  public async readBlob(commit: string, path: string, maxBytes: number): Promise<BlobResult> {
    if (!Git.isSha(commit)) throw new Error("readBlob takes a commit id");
    if (path === "" || path.includes("\0") || path.includes("\n")) return { kind: "missing" };

    const spec = `${commit}:${path}`;
    const type = await this.run(["cat-file", "-t", "--end-of-options", spec]);

    if (type.exitCode !== 0 || type.stdout.toString("utf8").trim() !== "blob") return { kind: "missing" };

    const size = Number((await this.outputText(["cat-file", "-s", "--end-of-options", spec])).trim());

    if (!Number.isSafeInteger(size) || size > maxBytes) return { kind: "too_large" };

    return { kind: "blob", bytes: await this.output(["cat-file", "blob", "--end-of-options", spec]) };
  }
}

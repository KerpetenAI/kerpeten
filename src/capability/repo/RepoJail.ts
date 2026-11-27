import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { exists, regularFile } from "../../files/files-utils.ts";
import { Capability, CapabilityBase, OnFlowStart, RunValue, Use } from "../../harness-kit/index.ts";
import { Git } from "../git/Git.ts";
import { HeadCommit } from "../git/HeadCommit.ts";
import type { Jail, JailIndex, JailResult, TrackedSets } from "./types/repo.ts";

/**
 * The repository of the run as the tools may see it: the work tree under its real root, limited to the files tracked
 * at the run's HEAD, which it reads once per run when a workflow that reaches it starts, before any model is called.
 */
@Capability({
  name: "repo-jail",
  description:
    "Keeps tool paths inside the repository: resolves a path, follows links and refuses anything outside the root or under .git.",
  permission: "repo:read",
  scope: "run",
})
export class RepoJail extends CapabilityBase implements Jail {
  public static readonly MAX_PATH_LENGTH = 4096;

  private static readonly MAX_LINK_HOPS = 40;

  @RunValue("repo")
  private readonly repo!: string;

  @Use(Git)
  private readonly git!: Git;

  @Use(HeadCommit)
  private readonly head!: HeadCommit;

  private indexed: JailIndex | undefined;

  public get root(): string {
    return this.index.root;
  }

  public get files(): readonly string[] {
    return this.index.files;
  }

  private get index(): JailIndex {
    if (this.indexed === undefined) throw new Error("the repository jail is used before the run built it");

    return this.indexed;
  }

  @OnFlowStart({ type: "run" })
  public async build(): Promise<void> {
    const root = realpathSync(this.repo);

    if (!lstatSync(root).isDirectory()) throw new Error(`${this.repo} is not a directory`);

    const { files, dirs } = RepoJail.trackedSets(await this.git.trackedFiles(this.head.sha));

    this.indexed = { root, files: [...files].sort(), trackedFiles: files, trackedDirs: dirs };
  }

  private static inside(root: string, target: string): boolean {
    return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
  }

  private static missing(root: string, path: string, hops = 0): JailResult {
    let existing = path;

    while (!exists(existing) && dirname(existing) !== existing) existing = dirname(existing);

    const rest = path.slice(existing.length).replace(/^[\\/]+/, "");
    let real: string;

    try {
      real = realpathSync(existing);
    } catch {
      return RepoJail.dangling(root, existing, rest, hops);
    }

    const target = resolve(real, rest);

    if (!RepoJail.inside(root, target)) return { ok: false, error: "path is outside the repository" };

    if (RepoJail.touchesGit(relative(root, target)))
      return { ok: false, error: "the .git directory is not accessible" };

    return { ok: false, error: "path does not exist" };
  }

  private static dangling(root: string, link: string, rest: string, hops: number): JailResult {
    let target: string;
    let dir: string;

    try {
      target = readlinkSync(link);
      dir = realpathSync(dirname(link));
    } catch {
      return { ok: false, error: "path cannot be resolved" };
    }

    if (!RepoJail.inside(root, dir)) return { ok: false, error: "path is outside the repository" };
    if (RepoJail.touchesGit(relative(root, dir))) return { ok: false, error: "the .git directory is not accessible" };
    if (hops >= RepoJail.MAX_LINK_HOPS) return { ok: false, error: "path cannot be resolved" };

    const next = isAbsolute(target) ? target : `${dir}${sep}${target}`;

    return RepoJail.missing(root, rest === "" ? next : `${next}${sep}${rest}`, hops + 1);
  }

  private static trackedSets(tracked: readonly string[]): TrackedSets {
    const files = new Set<string>();
    const dirs = new Set<string>();

    for (const path of tracked) {
      if (path === "" || RepoJail.touchesGit(path)) continue;

      files.add(path);

      let slash = path.lastIndexOf("/");

      while (slash > 0) {
        const dir = path.slice(0, slash);

        if (dirs.has(dir)) break;

        dirs.add(dir);
        slash = dir.lastIndexOf("/");
      }
    }

    return { files, dirs };
  }

  public static touchesGit(relativePath: string): boolean {
    return relativePath.split(/[\\/]/).some((part) => part.toLowerCase() === ".git");
  }

  public static absolutePath(input: string): boolean {
    return isAbsolute(input) || /^[A-Za-z]:/.test(input) || input.startsWith("\\");
  }

  public tracked(path: string): boolean {
    const { trackedFiles, trackedDirs } = this.index;

    return path === "." || trackedFiles.has(path) || trackedDirs.has(path);
  }

  public trackedFile(path: string): boolean {
    return this.index.trackedFiles.has(path);
  }

  public regularTrackedFile(path: string): boolean {
    if (!this.index.trackedFiles.has(path)) return false;

    const checked = this.resolve(path);

    return checked.ok && checked.relative === path && regularFile(checked.absolute) !== undefined;
  }

  public resolve(input: string): JailResult {
    const root = this.root;

    if (typeof input !== "string") return { ok: false, error: "path must be a string" };
    if (input.includes("\0")) return { ok: false, error: "path must not contain NUL" };
    if (input.length > RepoJail.MAX_PATH_LENGTH) return { ok: false, error: "path is too long" };

    if (RepoJail.absolutePath(input)) {
      return { ok: false, error: "path must be relative to the repository root" };
    }

    const lexical = join(root, input === "" ? "." : input);

    if (!RepoJail.inside(root, lexical)) return { ok: false, error: "path is outside the repository" };

    if (RepoJail.touchesGit(relative(root, lexical)))
      return { ok: false, error: "the .git directory is not accessible" };

    if (!existsSync(lexical)) return RepoJail.missing(root, lexical);

    let real: string;

    try {
      real = realpathSync(lexical);
    } catch {
      return { ok: false, error: "path cannot be resolved" };
    }

    if (!RepoJail.inside(root, real)) return { ok: false, error: "path is outside the repository" };

    const rel = relative(root, real);

    if (RepoJail.touchesGit(rel)) return { ok: false, error: "the .git directory is not accessible" };

    const relativePath = rel === "" ? "." : rel.split(sep).join("/");

    if (!this.tracked(relativePath)) return { ok: false, error: "path does not exist" };

    return { ok: true, absolute: real, relative: relativePath };
  }
}

import { Inject } from "@asenajs/ioc";
import type { z } from "zod";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import {
  Capability,
  ProcessCapability,
  type ProcessResult,
  type ProcessSettings,
  RunValue,
} from "../../harness-kit/index.ts";
import { errorMessage, terminalLine } from "../../text/text-utils.ts";
import { JsonLines } from "./JsonLines.ts";
import { PlatformError } from "./PlatformError.ts";
import { gitlabDiscussionSchema, gitlabMergeRequestSchema } from "./schemas/gitlab-schema.ts";
import type {
  GitLabDiscussion,
  GitLabMergeRequest,
  GitLabNote,
  GitLabPlace,
  GitLabPosition,
  GitLabSide,
} from "./types/gitlab.ts";
import type {
  MergeRequest,
  MergeRequestState,
  Platform,
  PlatformComment,
  PlatformComments,
  PlatformLines,
  PlatformList,
} from "./types/platform.ts";

/**
 * GitLab behind the `Platform` interface: reads a merge request and its comments with `glab api` in the run's
 * repository, so the sign-in is the one of the GitLab CLI and Kerpeten holds no GitLab token. glab fills `:fullpath`
 * from the repository of the working directory; in a clone with several remotes it takes the one it was told is the
 * base, else the remote named `upstream`, then `gitlab`, then `origin`. Its output is a pipe here, so it never asks.
 *
 * `glab api` can do whatever the sign-in can. So every public method is typed and builds its own arguments, each call
 * is a GET, and no method takes arguments from its caller. The capability declares no permission, so no tool of a
 * model can take it. What it reads is outside data: nothing of it is run or used as an argument.
 *
 * glab gets the program's environment with two settings of its own. `GLAB_COLOR=never` keeps color codes out of what
 * it prints, whatever its configuration says. `GLAB_CHECK_UPDATE=false` turns off its daily look for a new version,
 * which writes a notice to stderr and, when the look itself fails, can write a hint to stdout after the answer. Every
 * answer is asked for as lines of JSON, a form glab neither colors nor indents.
 */
@Capability({
  name: "gitlab-platform",
  description:
    "Reads a merge request and its comments from GitLab with glab api in the repository, through typed methods that only read; no tool can take it.",
  scope: "run",
})
export class GitLabPlatform extends ProcessCapability implements Platform {
  public static readonly COMMAND = "glab";

  private static readonly FIXED_ARGS: readonly string[] = ["api"];

  private static readonly READ: readonly string[] = ["--method", "GET", "--output", "ndjson"];

  private static readonly ALL_PAGES: readonly string[] = ["--paginate"];

  private static readonly PAGE_SIZE = 100;

  private static readonly SETTINGS: Readonly<Record<string, string>> = {
    GLAB_COLOR: "never",
    GLAB_CHECK_UPDATE: "false",
  };

  private static readonly ERROR_TITLE = /^ERROR /;

  private static readonly STATES: Readonly<Record<"opened" | "closed" | "merged", MergeRequestState>> = {
    opened: "open",
    closed: "closed",
    merged: "merged",
  };

  @Inject(Names.ENV)
  private readonly env!: Instances[Names.ENV];

  @RunValue("repo")
  private readonly repo!: string;

  private static assertNumber(number: number): void {
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new Error(`not a merge request number: ${JSON.stringify(number)}`);
    }
  }

  private static failure(result: ProcessResult, number: number): PlatformError {
    const stderr = terminalLine(result.stderr).replace(GitLabPlatform.ERROR_TITLE, "");

    if (stderr.includes("unable to expand placeholder")) {
      return new PlatformError(
        "no_repository",
        "glab finds no GitLab project in this folder: run inside a clone whose remote is on GitLab; for a GitLab host of your own, sign glab in to it first with `glab auth login --hostname <host>`",
      );
    }

    if (stderr.includes("HTTP 401")) {
      return new PlatformError(
        "signed_out",
        "GitLab did not accept the sign-in of glab (HTTP 401): run `glab auth login`, or correct the token in GITLAB_TOKEN when that variable is set, and run again",
      );
    }

    if (stderr.includes("HTTP 404")) {
      return new PlatformError(
        "not_found",
        `merge request ${number} was not found in the GitLab project of this folder: check the number; GitLab gives the same answer for a private project that glab cannot read, so check too that glab is signed in (\`glab auth login\`) with an account that can read the project`,
      );
    }

    return new PlatformError(
      "failed",
      `glab api failed (exit ${result.exitCode}): ${stderr === "" ? "it gave no error text" : stderr}`,
    );
  }

  private static unreadable(number: number, reason: string): PlatformError {
    return new PlatformError("failed", `the answer of glab for merge request ${number} cannot be read: ${reason}`);
  }

  private static host(mergeRequest: GitLabMergeRequest): string {
    let url: URL;

    try {
      url = new URL(mergeRequest.web_url);
    } catch {
      throw GitLabPlatform.unreadable(mergeRequest.iid, "web_url is no URL");
    }

    if (url.host === "") throw GitLabPlatform.unreadable(mergeRequest.iid, "web_url has no host");

    return url.host.toLowerCase();
  }

  private static state(mergeRequest: GitLabMergeRequest): MergeRequestState {
    if (mergeRequest.state === "locked") {
      throw new PlatformError(
        "failed",
        `merge request ${mergeRequest.iid} is locked: GitLab is merging it right now, so run again when the merge is done`,
      );
    }

    return GitLabPlatform.STATES[mergeRequest.state];
  }

  /** The side a position is on: the file before the change only for a line the change removed. */
  private static side(position: GitLabPosition): GitLabSide {
    const removed = position.position_type === "text" && (position.new_line ?? undefined) === undefined;

    return removed && (position.old_line ?? undefined) !== undefined ? "old" : "new";
  }

  /**
   * The lines of a position on its side: the range when it has one, else its one line, and none for a position on a
   * whole file. An end of the range that has no line on that side takes the position's own line.
   */
  private static lines(position: GitLabPosition, side: GitLabSide): PlatformLines | null {
    const own = (side === "old" ? position.old_line : position.new_line) ?? undefined;

    if (position.position_type !== "text" || own === undefined) return null;

    const range = position.line_range ?? undefined;

    if (range === undefined) return { start: own, end: own };

    const first = (side === "old" ? range.start.old_line : range.start.new_line) ?? own;
    const last = (side === "old" ? range.end.old_line : range.end.new_line) ?? own;

    return { start: Math.min(first, last), end: Math.max(first, last) };
  }

  /**
   * Where a note with a position sits. On the new side it is the file and the lines at the head commit the note was
   * written on. A note on a removed line has no line there: it is the file and the line as they were at the base
   * commit, where that line still is.
   */
  private static place(position: GitLabPosition): GitLabPlace {
    const side = GitLabPlatform.side(position);

    const { new_path: newPath, old_path: oldPath } = position;

    return {
      file: (side === "old" ? (oldPath ?? newPath) : (newPath ?? oldPath)) ?? null,
      lines: GitLabPlatform.lines(position, side),
      commit: side === "old" ? position.base_sha : position.head_sha,
    };
  }

  private static comment(note: GitLabNote, replyTo: string | null): PlatformComment {
    const position = note.position ?? undefined;
    const place = position === undefined ? { file: null, lines: null, commit: null } : GitLabPlatform.place(position);

    return {
      id: String(note.id),
      kind: position === undefined ? "general" : "line",
      author: note.author?.username ?? null,
      body: note.body,
      ...place,
      replyTo,
      createdAt: note.created_at,
    };
  }

  /** The comments of one discussion: its notes without GitLab's own event lines; every note after the first answers the first. */
  private static thread(discussion: GitLabDiscussion): PlatformComment[] {
    const notes = discussion.notes.filter((note) => !note.system);
    const first = notes[0];

    if (first === undefined) return [];

    return notes.map((note, index) => GitLabPlatform.comment(note, index === 0 ? null : String(first.id)));
  }

  /**
   * The merge request `number` of the project, where `number` is the one inside the project, its `iid`. A read that
   * fails throws a `PlatformError`, and so do an answer that is not the merge request asked for, a merge request
   * GitLab is merging right now and one that has no diff yet.
   */
  public async mergeRequest(number: number): Promise<MergeRequest> {
    GitLabPlatform.assertNumber(number);

    const result = await this.get([`projects/:fullpath/merge_requests/${number}`]);

    if (result.exitCode !== 0) throw GitLabPlatform.failure(result, number);

    let answer: unknown;

    try {
      answer = JSON.parse(result.stdout.toString("utf8"));
    } catch {
      throw GitLabPlatform.unreadable(number, "it is no JSON");
    }

    const parsed = gitlabMergeRequestSchema.safeParse(answer);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];

      throw GitLabPlatform.unreadable(number, `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "not as expected"}`);
    }

    const mergeRequest = parsed.data;

    if (mergeRequest.iid !== number) {
      throw GitLabPlatform.unreadable(number, `it is merge request ${mergeRequest.iid}`);
    }

    const state = GitLabPlatform.state(mergeRequest);

    if (mergeRequest.sha === null || mergeRequest.diff_refs === null) {
      throw new PlatformError(
        "failed",
        `merge request ${number} has no diff yet, GitLab names no commits for it: push a commit to its branch, or wait until GitLab has made the diff, and run again`,
      );
    }

    return {
      kind: "gitlab",
      host: GitLabPlatform.host(mergeRequest),
      projectId: String(mergeRequest.target_project_id),
      number: mergeRequest.iid,
      title: mergeRequest.title,
      description: mergeRequest.description ?? "",
      state,
      headSha: mergeRequest.sha,
      baseSha: mergeRequest.diff_refs.base_sha,
      baseRef: mergeRequest.target_branch,
    };
  }

  /**
   * The comments of merge request `number`, discussion by discussion in GitLab's order. The discussions are read to
   * their last page. The lines GitLab writes itself about events are no comments and are left out. A note in the diff
   * is a line comment, every other note a general one; in a discussion, every note after the first answers the first.
   * A list that glab did not read to its end, or whose entries cannot all be read, makes the result incomplete: it
   * holds what was read, and `problems` names the list. A missing glab, a sign-in GitLab does not accept, an unknown
   * merge request and a folder without a GitLab project throw a `PlatformError`, because then nothing can be read.
   */
  public async comments(number: number): Promise<PlatformComments> {
    GitLabPlatform.assertNumber(number);

    const discussions = await this.list(
      `projects/:fullpath/merge_requests/${number}/discussions`,
      number,
      gitlabDiscussionSchema,
    );

    return {
      comments: discussions.items.flatMap((discussion) => GitLabPlatform.thread(discussion)),
      complete: discussions.problems.length === 0,
      problems: discussions.problems,
    };
  }

  protected processSettings(): ProcessSettings {
    return {
      command: GitLabPlatform.COMMAND,
      fixedArgs: GitLabPlatform.FIXED_ARGS,
      cwd: this.repo,
      env: this.processEnv(),
    };
  }

  private processEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    for (const [name, value] of Object.entries(this.env)) {
      if (value !== undefined) env[name] = value;
    }

    return { ...env, ...GitLabPlatform.SETTINGS };
  }

  private async get(args: readonly string[]): Promise<ProcessResult> {
    try {
      return await this.collect([...GitLabPlatform.READ, ...args]);
    } catch (error) {
      const reason = terminalLine(errorMessage(error));

      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw new PlatformError("failed", `glab cannot be run: ${reason}`);
      }

      throw new PlatformError(
        "cli_missing",
        `glab, the GitLab CLI, is not found (${reason}): install it from https://gitlab.com/gitlab-org/cli and run again`,
      );
    }
  }

  private async list<T>(path: string, number: number, schema: z.ZodType<T>): Promise<PlatformList<T>> {
    const result = await this.get([...GitLabPlatform.ALL_PAGES, `${path}?per_page=${GitLabPlatform.PAGE_SIZE}`]);
    const failure = result.exitCode === 0 ? undefined : GitLabPlatform.failure(result, number);

    if (failure !== undefined && failure.kind !== "failed") throw failure;

    const lines = JsonLines.read(result.stdout.toString("utf8"));
    const items: T[] = [];
    const problems: string[] = [];

    for (const entry of lines.items) {
      const parsed = schema.safeParse(entry);

      if (parsed.success) items.push(parsed.data);
    }

    const unread = lines.items.length - items.length;

    if (failure !== undefined) problems.push(`${path}: ${failure.message}`);
    else if (!lines.whole) problems.push(`${path}: the answer of glab is not the lines of entries it should be`);

    if (unread > 0) problems.push(`${path}: ${unread} of ${lines.items.length} entries cannot be read`);

    return { items, problems };
  }
}

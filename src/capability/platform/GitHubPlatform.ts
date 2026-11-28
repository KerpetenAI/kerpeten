import { Inject } from "@asenajs/ioc";
import type { z } from "zod";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { Capability, ProcessCapability, type ProcessSettings, RunValue, Use } from "../../harness-kit/index.ts";
import { terminalLine } from "../../text/text-utils.ts";
import { LimitedOutput } from "./LimitedOutput.ts";
import { OriginProject } from "./OriginProject.ts";
import { PlatformError } from "./PlatformError.ts";
import { PlatformLimits } from "./PlatformLimits.ts";
import type { RemoteProject } from "./RemoteProject.ts";
import { SlurpedPages } from "./SlurpedPages.ts";
import {
  githubIssueCommentSchema,
  githubPullRequestSchema,
  githubReviewCommentSchema,
  githubReviewSchema,
} from "./schemas/github-schema.ts";
import type { GitHubIssueComment, GitHubPullRequest, GitHubReview, GitHubReviewComment } from "./types/github.ts";
import type {
  MergeRequest,
  Platform,
  PlatformComment,
  PlatformComments,
  PlatformExit,
  PlatformList,
  PlatformRead,
  PlatformReadLimits,
  PlatformSide,
  PlatformStop,
} from "./types/platform.ts";

/**
 * GitHub behind the `Platform` interface: reads a pull request and its comments with `gh api` in the run's repository,
 * so the sign-in is the one of the GitHub CLI and Kerpeten holds no GitHub token.
 *
 * The repository is the one the `origin` remote names, and gh chooses nothing: every call names the host with
 * `--hostname` and the owner and the repository in its path. gh's own choice among several remotes, which prefers a
 * remote named `upstream`, plays no part, so the pull request of another repository with the same number is never
 * read. The answer is checked to be of that repository all the same.
 *
 * `gh api` can do whatever the sign-in can. So every public method is typed and builds its own arguments, each call is
 * a GET, and no method takes arguments from its caller. The capability declares no permission, so no tool of a model
 * can take it. What it reads is outside data: nothing of it is run. The host and the path of the origin remote are
 * the one outside data that becomes part of an argument, and `RemoteProject` lets through only what a host name and
 * the path of a repository can be.
 *
 * gh gets the program's environment without the variables that force colors, which would put color codes into the
 * JSON it prints.
 *
 * Every read has a budget, `PlatformLimits`: the bytes gh may print and the time it may take. A read that reaches
 * either is stopped. For the pull request that is an error; for a list of comments the result is incomplete and says
 * which limit stopped it.
 */
@Capability({
  name: "github-platform",
  description:
    "Reads a pull request and its comments from GitHub with gh api, from the repository the origin remote names, through typed methods that only read; no tool can take it.",
  scope: "run",
})
export class GitHubPlatform extends ProcessCapability implements Platform {
  public static readonly COMMAND = "gh";

  private static readonly FIXED_ARGS: readonly string[] = ["api"];

  private static readonly READ: readonly string[] = ["--method", "GET"];

  private static readonly ALL_PAGES: readonly string[] = ["--paginate", "--slurp"];

  private static readonly PAGE_SIZE = 100;

  private static readonly NOT_SIGNED_IN_EXIT = 4;

  private static readonly COLOR_FORCING: readonly string[] = ["CLICOLOR_FORCE", "GH_FORCE_TTY"];

  private static readonly SIDES: Readonly<Record<"LEFT" | "RIGHT", PlatformSide>> = { LEFT: "old", RIGHT: "new" };

  private static readonly WHOLE_FILE = "file";

  private static readonly MS_PER_SECOND = 1000;

  private static readonly REPOSITORY_NAMES = 2;

  @Use(OriginProject)
  private readonly origin!: OriginProject;

  @Inject(Names.ENV)
  private readonly env!: Instances[Names.ENV];

  @RunValue("repo")
  private readonly repo!: string;

  private static assertNumber(number: number): void {
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new Error(`not a pull request number: ${JSON.stringify(number)}`);
    }
  }

  /**
   * Why a read of gh failed. gh ends with 4 when it is signed in to no host; a host it is not signed in to, beside
   * others it is, gets the request without a sign-in, which GitHub answers with 401 or, for a repository that is not
   * public, with 404.
   */
  private static failure(result: PlatformExit, number: number, project: RemoteProject): PlatformError {
    const stderr = terminalLine(result.stderr);

    if (result.exitCode === GitHubPlatform.NOT_SIGNED_IN_EXIT || stderr.includes("HTTP 401")) {
      return new PlatformError(
        "signed_out",
        `gh is not signed in to ${project.host}: run \`gh auth login --hostname ${project.host}\` and run again`,
      );
    }

    if (stderr.includes("HTTP 404")) {
      return new PlatformError(
        "not_found",
        `pull request ${number} was not found in ${project.name}, the repository of the origin remote: check the number, and that gh is signed in to ${project.host} with an account that can read the repository; a pull request of another repository, such as the one a fork was made from, is not read`,
      );
    }

    return new PlatformError(
      "failed",
      `gh api failed (exit ${result.exitCode}): ${stderr === "" ? "it gave no error text" : stderr}`,
    );
  }

  private static unreadable(number: number, reason: string): PlatformError {
    return new PlatformError("failed", `the answer of gh for pull request ${number} cannot be read: ${reason}`);
  }

  private static host(pull: GitHubPullRequest): string {
    let url: URL;

    try {
      url = new URL(pull.html_url);
    } catch {
      throw GitHubPlatform.unreadable(pull.number, "html_url is no URL");
    }

    if (url.host === "") throw GitHubPlatform.unreadable(pull.number, "html_url has no host");

    return url.host.toLowerCase();
  }

  /** What a read that was stopped at a limit says, after the name of what was read. */
  private static stopped(read: PlatformStop): string {
    if (read.kind === "too_large") return `gh printed more than ${read.bytes} bytes, and the read stopped there`;

    return `gh did not finish within ${read.ms / GitHubPlatform.MS_PER_SECOND} seconds, and the read stopped there`;
  }

  /**
   * A review comment in the platform's words. Its lines are the ones gh gives for the pull request as it is now, and
   * the ones the comment was written on when it is outdated; `commit` is the head commit of that state. The lines
   * count on the side of the comment's last line. A comment whose first line is on the other side gives its last
   * line alone. A comment on a whole file has no lines and no side, whatever line gh names for it.
   */
  private static lineComment(comment: GitHubReviewComment): PlatformComment {
    const current = comment.line ?? undefined;
    const end = current ?? comment.original_line ?? undefined;
    const first = current === undefined ? comment.original_start_line : comment.start_line;
    const onLines = comment.subject_type !== GitHubPlatform.WHOLE_FILE && end !== undefined;
    const oneSide = (comment.start_side ?? comment.side) === comment.side;

    return {
      id: String(comment.id),
      kind: "line",
      author: comment.user?.login ?? null,
      body: comment.body,
      file: comment.path,
      lines: onLines ? { start: oneSide ? (first ?? end) : end, end } : null,
      side: onLines ? GitHubPlatform.SIDES[comment.side] : null,
      commit: current === undefined ? comment.original_commit_id : comment.commit_id,
      replyTo: comment.in_reply_to_id === undefined ? null : String(comment.in_reply_to_id),
      createdAt: comment.created_at,
    };
  }

  private static conversationComment(comment: GitHubIssueComment): PlatformComment {
    return {
      id: String(comment.id),
      kind: "general",
      author: comment.user?.login ?? null,
      body: comment.body,
      file: null,
      lines: null,
      side: null,
      commit: null,
      replyTo: null,
      createdAt: comment.created_at,
    };
  }

  private static reviewBody(review: GitHubReview, body: string): PlatformComment {
    return {
      id: String(review.id),
      kind: "general",
      author: review.user?.login ?? null,
      body,
      file: null,
      lines: null,
      side: null,
      commit: review.commit_id ?? null,
      replyTo: null,
      createdAt: review.submitted_at ?? null,
    };
  }

  /**
   * The pull request `number` of the repository of the `origin` remote. A read that fails throws a `PlatformError`,
   * and so does an answer that is not the pull request asked for or not of that repository.
   */
  public async mergeRequest(number: number): Promise<MergeRequest> {
    GitHubPlatform.assertNumber(number);

    const project = await this.repository();
    const result = await this.get(project, [`repos/${project.path}/pulls/${number}`]);

    if (result.kind !== "exited") {
      throw new PlatformError("failed", `pull request ${number} was not read: ${GitHubPlatform.stopped(result)}`);
    }

    if (result.exitCode !== 0) throw GitHubPlatform.failure(result, number, project);

    let answer: unknown;

    try {
      answer = JSON.parse(result.stdout.toString("utf8"));
    } catch {
      throw GitHubPlatform.unreadable(number, "it is no JSON");
    }

    const parsed = githubPullRequestSchema.safeParse(answer);

    if (!parsed.success) {
      const issue = parsed.error.issues[0];

      throw GitHubPlatform.unreadable(number, `${issue?.path.join(".") ?? ""}: ${issue?.message ?? "not as expected"}`);
    }

    const pull = parsed.data;

    if (pull.number !== number) throw GitHubPlatform.unreadable(number, `it is pull request ${pull.number}`);

    if (!project.is(pull.base.repo.full_name)) {
      throw new PlatformError(
        "failed",
        `gh answered with a pull request of ${JSON.stringify(terminalLine(pull.base.repo.full_name))}, not of ${project.path}, the repository of the origin remote; when the repository was renamed or moved, point the origin remote at its new address and run again`,
      );
    }

    return {
      kind: "github",
      host: GitHubPlatform.host(pull),
      projectId: String(pull.base.repo.id),
      number: pull.number,
      title: pull.title,
      description: pull.body ?? "",
      state: pull.merged ? "merged" : pull.state,
      headSha: pull.head.sha,
      baseSha: pull.base.sha,
      baseRef: pull.base.ref,
    };
  }

  /**
   * The comments of pull request `number`: the comments on lines, then the bodies of the reviews, which are general
   * comments, then the comments of the conversation. Each of the three lists is read to its last page. A list
   * that gh did not read to its end, or whose entries cannot all be read, makes the result incomplete: it holds what
   * was read, and `problems` names the list. So does a list that is larger than the byte limit of a read or takes
   * longer than its time limit: the entries of the pages that stand whole before the stop are kept. A missing gh, a
   * missing sign-in, an unknown pull request and an `origin` remote that names no GitHub repository throw a
   * `PlatformError`, because then nothing can be read.
   */
  public async comments(number: number): Promise<PlatformComments> {
    GitHubPlatform.assertNumber(number);

    const project = await this.repository();
    const pull = `repos/${project.path}/pulls/${number}`;
    const onLines = await this.list(project, `${pull}/comments`, number, githubReviewCommentSchema);
    const reviews = await this.list(project, `${pull}/reviews`, number, githubReviewSchema);

    const conversation = await this.list(
      project,
      `repos/${project.path}/issues/${number}/comments`,
      number,
      githubIssueCommentSchema,
    );

    const problems = [...onLines.problems, ...reviews.problems, ...conversation.problems];

    return {
      comments: [
        ...onLines.items.map((comment) => GitHubPlatform.lineComment(comment)),
        ...reviews.items.flatMap((review) => {
          const body = review.body ?? "";

          return body.trim() === "" ? [] : [GitHubPlatform.reviewBody(review, body)];
        }),
        ...conversation.items.map((comment) => GitHubPlatform.conversationComment(comment)),
      ],
      complete: problems.length === 0,
      problems,
    };
  }

  protected processSettings(): ProcessSettings {
    return {
      command: GitHubPlatform.COMMAND,
      fixedArgs: GitHubPlatform.FIXED_ARGS,
      cwd: this.repo,
      env: this.processEnv(),
    };
  }

  private processEnv(): Record<string, string> {
    const env: Record<string, string> = {};

    for (const [name, value] of Object.entries(this.env)) {
      if (value !== undefined && !GitHubPlatform.COLOR_FORCING.includes(name)) env[name] = value;
    }

    return env;
  }

  /** The repository of the `origin` remote, which on GitHub is an owner and a name. */
  private async repository(): Promise<RemoteProject> {
    const project = await this.origin.project();

    if (project.names.length !== GitHubPlatform.REPOSITORY_NAMES) {
      throw new PlatformError(
        "no_repository",
        `the origin remote names ${project.name}, which is no GitHub repository: a repository is an owner and a name, <owner>/<name>`,
      );
    }

    return project;
  }

  /** The budget of one read of gh. */
  protected readLimits(): PlatformReadLimits {
    return { bytes: PlatformLimits.READ_BYTES, ms: PlatformLimits.READ_MS };
  }

  /**
   * Runs one GET of gh on the host of `project`, inside the budget of a read, and gives what it printed and how it
   * ended. A gh that cannot be started throws a `PlatformError`.
   */
  private async get(project: RemoteProject, args: readonly string[]): Promise<PlatformRead> {
    const { bytes, ms } = this.readLimits();
    const output = new LimitedOutput(bytes);
    const read = [...GitHubPlatform.READ, "--hostname", project.host, ...args];
    const outcome = await this.stream(read, (chunk) => output.take(chunk), ms);

    switch (outcome.kind) {
      case "not_started": {
        const reason = terminalLine(outcome.error);

        if (outcome.code !== "ENOENT") throw new PlatformError("failed", `gh cannot be run: ${reason}`);

        throw new PlatformError(
          "cli_missing",
          `gh, the GitHub CLI, is not found (${reason}): install it from https://cli.github.com and run again`,
        );
      }
      case "timed_out":
        return { kind: "timed_out", stdout: output.bytes, ms };
      case "stopped":
        return { kind: "too_large", stdout: output.bytes, bytes };
      case "exited":
        return { kind: "exited", exitCode: outcome.exitCode, stdout: output.bytes, stderr: outcome.stderr };
    }
  }

  private async list<T>(
    project: RemoteProject,
    path: string,
    number: number,
    schema: z.ZodType<T>,
  ): Promise<PlatformList<T>> {
    const result = await this.get(project, [
      ...GitHubPlatform.ALL_PAGES,
      `${path}?per_page=${GitHubPlatform.PAGE_SIZE}`,
    ]);

    const failure =
      result.kind !== "exited" || result.exitCode === 0 ? undefined : GitHubPlatform.failure(result, number, project);

    if (failure !== undefined && failure.kind !== "failed") throw failure;

    const pages = SlurpedPages.read(result.stdout.toString("utf8"));
    const items: T[] = [];
    const problems: string[] = [];

    for (const entry of pages.items) {
      const parsed = schema.safeParse(entry);

      if (parsed.success) items.push(parsed.data);
    }

    const unread = pages.items.length - items.length;

    if (result.kind !== "exited") problems.push(`${path}: ${GitHubPlatform.stopped(result)}`);
    else if (failure !== undefined) problems.push(`${path}: ${failure.message}`);
    else if (!pages.whole) problems.push(`${path}: the answer of gh is not the list of pages it should be`);

    if (unread > 0) problems.push(`${path}: ${unread} of ${pages.items.length} entries cannot be read`);

    return { items, problems };
  }
}

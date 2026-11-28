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
import { PlatformError } from "./PlatformError.ts";
import { SlurpedPages } from "./SlurpedPages.ts";
import {
  githubIssueCommentSchema,
  githubPullRequestSchema,
  githubReviewCommentSchema,
  githubReviewSchema,
} from "./schemas/github-schema.ts";
import type { GitHubIssueComment, GitHubPullRequest, GitHubReview, GitHubReviewComment } from "./types/github.ts";
import type { MergeRequest, Platform, PlatformComment, PlatformComments, PlatformList } from "./types/platform.ts";

/**
 * GitHub behind the `Platform` interface: reads a pull request and its comments with `gh api` in the run's repository,
 * so the sign-in is the one of the GitHub CLI and Kerpeten holds no GitHub token. gh fills `{owner}/{repo}` from the
 * repository of the working directory.
 *
 * `gh api` can do whatever the sign-in can. So every public method is typed and builds its own arguments, each call is
 * a GET, and no method takes arguments from its caller. The capability declares no permission, so no tool of a model
 * can take it. What it reads is outside data: nothing of it is run or used as an argument.
 *
 * gh gets the program's environment without the variables that force colors, which would put color codes into the
 * JSON it prints.
 */
@Capability({
  name: "github-platform",
  description:
    "Reads a pull request and its comments from GitHub with gh api in the repository, through typed methods that only read; no tool can take it.",
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

  @Inject(Names.ENV)
  private readonly env!: Instances[Names.ENV];

  @RunValue("repo")
  private readonly repo!: string;

  private static assertNumber(number: number): void {
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new Error(`not a pull request number: ${JSON.stringify(number)}`);
    }
  }

  private static failure(result: ProcessResult, number: number): PlatformError {
    const stderr = terminalLine(result.stderr);

    if (result.exitCode === GitHubPlatform.NOT_SIGNED_IN_EXIT) {
      return new PlatformError("signed_out", "gh is not signed in to GitHub: run `gh auth login` and run again");
    }

    if (stderr.includes("unable to expand placeholder")) {
      return new PlatformError(
        "no_repository",
        "gh finds no GitHub repository in this folder: run inside a clone whose remote is on GitHub",
      );
    }

    if (stderr.includes("HTTP 404")) {
      return new PlatformError(
        "not_found",
        `pull request ${number} was not found in the GitHub repository of this folder: check the number, and that the sign-in of gh can read the repository`,
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

  private static lineComment(comment: GitHubReviewComment): PlatformComment {
    const current = comment.line ?? undefined;
    const end = current ?? comment.original_line ?? undefined;
    const first = current === undefined ? comment.original_start_line : comment.start_line;

    return {
      id: String(comment.id),
      kind: "line",
      author: comment.user?.login ?? null,
      body: comment.body,
      file: comment.path,
      lines: end === undefined ? null : { start: first ?? end, end },
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
      commit: review.commit_id ?? null,
      replyTo: null,
      createdAt: review.submitted_at ?? null,
    };
  }

  /**
   * The pull request `number` of the repository. A read that fails throws a `PlatformError`, and so does an answer
   * that is not the pull request asked for.
   */
  public async mergeRequest(number: number): Promise<MergeRequest> {
    GitHubPlatform.assertNumber(number);

    const result = await this.get([`repos/{owner}/{repo}/pulls/${number}`]);

    if (result.exitCode !== 0) throw GitHubPlatform.failure(result, number);

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
   * was read, and `problems` names the list. A missing gh, a missing sign-in, an unknown pull request and a folder
   * without a GitHub repository throw a `PlatformError`, because then nothing can be read.
   */
  public async comments(number: number): Promise<PlatformComments> {
    GitHubPlatform.assertNumber(number);

    const pull = `repos/{owner}/{repo}/pulls/${number}`;
    const onLines = await this.list(`${pull}/comments`, number, githubReviewCommentSchema);
    const reviews = await this.list(`${pull}/reviews`, number, githubReviewSchema);

    const conversation = await this.list(
      `repos/{owner}/{repo}/issues/${number}/comments`,
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

  private async get(args: readonly string[]): Promise<ProcessResult> {
    try {
      return await this.collect([...GitHubPlatform.READ, ...args]);
    } catch (error) {
      const reason = terminalLine(errorMessage(error));

      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
        throw new PlatformError("failed", `gh cannot be run: ${reason}`);
      }

      throw new PlatformError(
        "cli_missing",
        `gh, the GitHub CLI, is not found (${reason}): install it from https://cli.github.com and run again`,
      );
    }
  }

  private async list<T>(path: string, number: number, schema: z.ZodType<T>): Promise<PlatformList<T>> {
    const result = await this.get([...GitHubPlatform.ALL_PAGES, `${path}?per_page=${GitHubPlatform.PAGE_SIZE}`]);
    const failure = result.exitCode === 0 ? undefined : GitHubPlatform.failure(result, number);

    if (failure !== undefined && failure.kind !== "failed") throw failure;

    const pages = SlurpedPages.read(result.stdout.toString("utf8"));
    const items: T[] = [];
    const problems: string[] = [];

    for (const entry of pages.items) {
      const parsed = schema.safeParse(entry);

      if (parsed.success) items.push(parsed.data);
    }

    const unread = pages.items.length - items.length;

    if (failure !== undefined) problems.push(`${path}: ${failure.message}`);
    else if (!pages.whole) problems.push(`${path}: the answer of gh is not the list of pages it should be`);

    if (unread > 0) problems.push(`${path}: ${unread} of ${pages.items.length} entries cannot be read`);

    return { items, problems };
  }
}

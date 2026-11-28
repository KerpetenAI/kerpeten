import type { z } from "zod";
import type { RemoteProject } from "../RemoteProject.ts";
import type {
  githubIssueCommentSchema,
  githubPullRequestSchema,
  githubReviewCommentSchema,
  githubReviewSchema,
  githubWriteErrorSchema,
  githubWrittenCommentSchema,
  githubWrittenSchema,
} from "../schemas/github-schema.ts";
import type { FailedWrite } from "./platform.ts";

export type GitHubPullRequest = z.infer<typeof githubPullRequestSchema>;

export type GitHubReviewComment = z.infer<typeof githubReviewCommentSchema>;

export type GitHubReview = z.infer<typeof githubReviewSchema>;

export type GitHubIssueComment = z.infer<typeof githubIssueCommentSchema>;

export type GitHubWritten = z.infer<typeof githubWrittenSchema>;

export type GitHubWrittenComment = z.infer<typeof githubWrittenCommentSchema>;

export type GitHubWriteError = z.infer<typeof githubWriteErrorSchema>;

/**
 * How GitHub answered a write of gh:
 *
 * - `written`: GitHub took it, and `id` is the id of what it made or changed.
 * - `invalid`: GitHub refused the request as one it cannot take (HTTP 422) and wrote nothing; for a review, a comment
 *   on a line that is not in the diff is such a request. `reason` is GitHub's own text.
 * - `failed`: anything else; `message` says what happened and what to do, with GitHub's own text in it.
 */
export type GitHubWriteResult =
  | { readonly kind: "written"; readonly id: number }
  | { readonly kind: "invalid"; readonly reason: string }
  | FailedWrite;

/** A request GitHub refuses as invalid for a reason that no line of a comment causes: how its answer is known, and what to do. */
export interface GitHubBlock {
  readonly answer: RegExp;
  readonly advice: string;
}

/** A line comment as the body of a GitHub review holds it. */
export interface GitHubReviewLine {
  readonly path: string;
  readonly line: number;
  readonly side: "RIGHT";
  readonly start_line?: number;
  readonly start_side?: "RIGHT";
  readonly body: string;
}

/** The body of `POST /repos/{owner}/{repo}/pulls/{number}/reviews`: one review of line comments at one commit. */
export interface GitHubReviewRequest {
  readonly commit_id: string;
  readonly event: "COMMENT";
  readonly comments: readonly GitHubReviewLine[];
}

/** The pull request a review is written to: its repository, its number and the commit the review was of. */
export interface GitHubReviewTarget {
  readonly project: RemoteProject;
  readonly number: number;
  readonly headSha: string;
}

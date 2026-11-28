import type { z } from "zod";
import type {
  githubIssueCommentSchema,
  githubPullRequestSchema,
  githubReviewCommentSchema,
  githubReviewSchema,
} from "../schemas/github-schema.ts";

export type GitHubPullRequest = z.infer<typeof githubPullRequestSchema>;

export type GitHubReviewComment = z.infer<typeof githubReviewCommentSchema>;

export type GitHubReview = z.infer<typeof githubReviewSchema>;

export type GitHubIssueComment = z.infer<typeof githubIssueCommentSchema>;

import { z } from "zod";

const id = z.int().positive();

const sha = z.string().regex(/^[0-9a-f]{40}$/);

const line = z.int().positive().nullish();

const user = z.object({ login: z.string() }).nullish();

/** The fields of `GET /repos/{owner}/{repo}/pulls/{number}` the review reads. */
export const githubPullRequestSchema = z.object({
  html_url: z.string(),
  number: id,
  state: z.enum(["open", "closed"]),
  merged: z.boolean(),
  title: z.string(),
  body: z.string().nullable(),
  head: z.object({ sha }),
  base: z.object({ sha, ref: z.string(), repo: z.object({ id }) }),
});

/** A review comment of a pull request: a comment on lines of a file. A reply names the comment it answers. */
export const githubReviewCommentSchema = z.object({
  id,
  user,
  body: z.string(),
  path: z.string(),
  line,
  start_line: line,
  original_line: line,
  original_start_line: line,
  commit_id: sha,
  original_commit_id: sha,
  in_reply_to_id: id.optional(),
  created_at: z.string(),
});

/** A review of a pull request; its body, when it has one, is a general comment. */
export const githubReviewSchema = z.object({
  id,
  user,
  body: z.string().nullish(),
  state: z.string(),
  commit_id: sha.nullish(),
  submitted_at: z.string().optional(),
});

/** A comment on the conversation of a pull request. */
export const githubIssueCommentSchema = z.object({
  id,
  user,
  body: z.string(),
  created_at: z.string(),
});

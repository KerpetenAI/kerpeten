import { z } from "zod";

const id = z.int().positive();

const sha = z.string().regex(/^[0-9a-f]{40}$/);

const line = z.int().positive().nullish();

const rangeEnd = z.object({ new_line: line, old_line: line });

/**
 * The fields of `GET /projects/:id/merge_requests/:iid` the review reads. `iid` is the number inside the project.
 * `sha` and `diff_refs` are null while the merge request has no diff.
 */
export const gitlabMergeRequestSchema = z.object({
  web_url: z.string(),
  iid: id,
  target_project_id: id,
  state: z.enum(["opened", "closed", "merged", "locked"]),
  title: z.string(),
  description: z.string().nullable(),
  sha: sha.nullable(),
  target_branch: z.string(),
  diff_refs: z.object({ base_sha: sha }).nullable(),
});

/**
 * Where a note sits in the diff. A `text` position is on lines: `new_line` is the line after the change, `old_line`
 * the line before it; an added line has only the first, a removed line only the second, an unchanged line both.
 * `line_range` is there when the note is on more than one line. A `file` or `image` position names no line. GitLab
 * gives one of the two paths as null for some notes; a position that names no path at all cannot be read.
 */
export const gitlabPositionSchema = z
  .object({
    position_type: z.enum(["text", "file", "image"]),
    new_path: z.string().nullish(),
    old_path: z.string().nullish(),
    new_line: line,
    old_line: line,
    head_sha: sha,
    base_sha: sha,
    line_range: z.object({ start: rangeEnd, end: rangeEnd }).nullish(),
  })
  .refine((position) => (position.new_path ?? position.old_path ?? undefined) !== undefined, "names no file");

/** A note of a discussion. A system note is a line GitLab wrote about an event, not a comment. */
export const gitlabNoteSchema = z.object({
  id,
  body: z.string(),
  author: z.object({ username: z.string() }).nullish(),
  created_at: z.string(),
  system: z.boolean(),
  position: gitlabPositionSchema.nullish(),
});

/** A discussion of a merge request: its notes in order, the first one starts the thread. */
export const gitlabDiscussionSchema = z.object({
  notes: z.array(gitlabNoteSchema),
});

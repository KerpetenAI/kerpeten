import type { z } from "zod";
import type {
  gitlabDiscussionSchema,
  gitlabMergeRequestSchema,
  gitlabNoteSchema,
  gitlabPositionSchema,
} from "../schemas/gitlab-schema.ts";
import type { PlatformComment } from "./platform.ts";

export type GitLabMergeRequest = z.infer<typeof gitlabMergeRequestSchema>;

export type GitLabDiscussion = z.infer<typeof gitlabDiscussionSchema>;

export type GitLabNote = z.infer<typeof gitlabNoteSchema>;

export type GitLabPosition = z.infer<typeof gitlabPositionSchema>;

/** The side of the diff a position is on: the file after the change, or the file before it. */
export type GitLabSide = "new" | "old";

/** Where a comment sits, in the fields of a platform comment. */
export type GitLabPlace = Pick<PlatformComment, "file" | "lines" | "commit">;

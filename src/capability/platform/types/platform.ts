/** The kind of platform a merge request lives on. */
export type PlatformKind = "github";

export type MergeRequestState = "open" | "closed" | "merged";

/**
 * A merge request as a platform gives it, in words no platform owns: a GitHub pull request is one. `host` is the
 * platform's host in lowercase without a scheme, `projectId` the platform's own id of the repository the merge request
 * goes into. The title and the description are outside data.
 */
export interface MergeRequest {
  readonly kind: PlatformKind;
  readonly host: string;
  readonly projectId: string;
  readonly number: number;
  readonly title: string;
  readonly description: string;
  readonly state: MergeRequestState;
  readonly headSha: string;
  readonly baseSha: string;
  readonly baseRef: string;
}

export type PlatformCommentKind = "line" | "general";

export interface PlatformLines {
  readonly start: number;
  readonly end: number;
}

/**
 * A comment on a merge request. A line comment sits on lines of a file at a commit; a general comment belongs to the
 * merge request as a whole. A field that does not exist for a comment is `null`: `file`, `lines` and `replyTo` of a
 * general comment, `lines` of a comment on a whole file, `replyTo` of a comment that starts a thread. The author and
 * the body are outside data.
 */
export interface PlatformComment {
  readonly id: string;
  readonly kind: PlatformCommentKind;
  readonly author: string | null;
  readonly body: string;
  readonly file: string | null;
  readonly lines: PlatformLines | null;
  readonly commit: string | null;
  readonly replyTo: string | null;
  readonly createdAt: string | null;
}

/**
 * The comments of a merge request. `complete` is false when a part of them could not be read to its end; `comments`
 * then holds what was read and `problems` says, one line per part, what was not.
 */
export interface PlatformComments {
  readonly comments: readonly PlatformComment[];
  readonly complete: boolean;
  readonly problems: readonly string[];
}

/** Why a platform read failed: the platform's command line tool is missing, it is not signed in, the merge request or the repository was not found, or anything else. */
export type PlatformFailure = "cli_missing" | "signed_out" | "not_found" | "no_repository" | "failed";

/** What the review reads from the platform a merge request lives on. */
export interface Platform {
  mergeRequest(number: number): Promise<MergeRequest>;
  comments(number: number): Promise<PlatformComments>;
}

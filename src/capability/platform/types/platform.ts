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

/** The side of a change a line is on: `new` is the file as the change leaves it, `old` the file as it was before. */
export type PlatformSide = "old" | "new";

export interface PlatformLines {
  readonly start: number;
  readonly end: number;
}

/**
 * A comment on a merge request. A general comment belongs to the merge request as a whole. A line comment sits in the
 * change of the merge request as it was at one commit:
 *
 * - `commit` is the last commit of the change the comment was written on, the head of that diff.
 * - `file` is the path of the file as that change leaves it. A file the change renamed is named by its new path, a
 *   file the change removed by the path it had.
 * - `side` says which file `lines` count in. `new`: the file at `commit`. `old`: the file as it was before the
 *   change, at the base of that diff, which no field names; a comment on a line the change removed is there.
 * - `lines` are the first and the last line of the comment on that side. A comment on more than one line whose first
 *   line is on the other side than its last gives its last line alone, because the number of its first line counts
 *   in the other file.
 *
 * A field that does not exist for a comment is `null`: `file`, `lines`, `side` and `replyTo` of a general comment,
 * `lines` and `side` of a comment on a whole file, `replyTo` of a comment that starts a thread. The author and the
 * body are outside data.
 */
export interface PlatformComment {
  readonly id: string;
  readonly kind: PlatformCommentKind;
  readonly author: string | null;
  readonly body: string;
  readonly file: string | null;
  readonly lines: PlatformLines | null;
  readonly side: PlatformSide | null;
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

/** The budget of one read of a platform's command line tool: the most bytes it may print and the time it may take. */
export interface PlatformReadLimits {
  readonly bytes: number;
  readonly ms: number;
}

/** A read of a platform's command line tool that ran to its end, with what the tool printed and how it exited. */
export interface PlatformExit {
  readonly kind: "exited";
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: string;
}

/**
 * A read that was stopped at a limit of its budget: the tool printed more than `bytes`, or it took longer than `ms`.
 * `stdout` holds what was printed up to there.
 */
export type PlatformStop =
  | { readonly kind: "too_large"; readonly stdout: Buffer; readonly bytes: number }
  | { readonly kind: "timed_out"; readonly stdout: Buffer; readonly ms: number };

/** How one read of a platform's command line tool ended. */
export type PlatformRead = PlatformExit | PlatformStop;

/** Why a platform read failed: the platform's command line tool is missing, it is not signed in, the merge request or the repository was not found, or anything else. */
export type PlatformFailure = "cli_missing" | "signed_out" | "not_found" | "no_repository" | "failed";

/** What the review reads from the platform a merge request lives on. */
export interface Platform {
  mergeRequest(number: number): Promise<MergeRequest>;
  comments(number: number): Promise<PlatformComments>;
}

/** The command line tools of the platforms that a test puts a script in the place of. */
export type CliName = "gh" | "glab";

/**
 * What a fake CLI does for one path: what it prints, what it writes to stderr and how it exits, 0 when left out. With
 * `hangs` it does not exit after it printed: it stays for half a minute, as a tool that waits for an answer.
 */
export interface CliAnswer {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly hangs?: boolean;
}

/** What the fake gh does for one path. */
export type GhAnswer = CliAnswer;

/** The paths `GitHubPlatform` asks gh for, for one pull request. */
export interface GhPaths {
  readonly pull: string;
  readonly comments: string;
  readonly reviews: string;
  readonly conversation: string;
}

/** The fields of a pull request answer a test sets; the others take the values of an open pull request on github.com. */
export interface PullFields {
  readonly number?: number;
  readonly headSha?: string;
  readonly baseSha?: string;
  readonly title?: string;
  readonly body?: string | null;
  readonly state?: string;
  readonly merged?: boolean;
  readonly htmlUrl?: string;
  readonly repoId?: number;
}

/** The paths `GitLabPlatform` asks glab for, for one merge request. */
export interface GlabPaths {
  readonly mergeRequest: string;
  readonly discussions: string;
}

/**
 * The fields of a merge request answer a test sets; the others take the values of an open merge request on
 * gitlab.com. A `sha` or `baseSha` of null is a merge request without a diff.
 */
export interface MergeRequestFields {
  readonly iid?: number;
  readonly sha?: string | null;
  readonly baseSha?: string | null;
  readonly title?: string;
  readonly description?: string | null;
  readonly state?: string;
  readonly webUrl?: string;
  readonly projectId?: number;
}

/** The fields of a position a test sets. */
export interface PositionFields {
  readonly position_type?: string;
  readonly old_path?: string | null;
  readonly new_path?: string | null;
  readonly old_line?: number | null;
  readonly new_line?: number | null;
  readonly head_sha?: string;
  readonly base_sha?: string;
  readonly line_range?: unknown;
}

/** The fields of a note a test sets. */
export interface NoteFields {
  readonly type?: string | null;
  readonly body?: string;
  readonly author?: unknown;
  readonly created_at?: string;
  readonly system?: boolean;
  readonly position?: unknown;
}

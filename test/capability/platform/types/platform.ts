/** What the fake gh does for one path: what it prints, what it writes to stderr and how it exits, 0 when left out. */
export interface GhAnswer {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}

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

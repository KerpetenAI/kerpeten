import type { ProcessOutcome } from "../../../harness-kit/index.ts";

export type JailResult =
  | { readonly ok: true; readonly absolute: string; readonly relative: string }
  | { readonly ok: false; readonly error: string };

export interface Jail {
  readonly root: string;
  readonly files: readonly string[];
  resolve(input: string): JailResult;
  tracked(relativePath: string): boolean;
  trackedFile(relativePath: string): boolean;
  regularTrackedFile(relativePath: string): boolean;
}

export interface RipgrepQuery {
  readonly pattern: string;
  readonly target: string;
  readonly caseInsensitive: boolean;
  readonly fixedStrings: boolean;
}

export type RipgrepOutcome = ProcessOutcome;

export interface TrackedSets {
  readonly files: Set<string>;
  readonly dirs: Set<string>;
}

/** What a repository jail knows once its run built it: the real root and the files tracked at HEAD. */
export interface JailIndex {
  readonly root: string;
  readonly files: readonly string[];
  readonly trackedFiles: ReadonlySet<string>;
  readonly trackedDirs: ReadonlySet<string>;
}

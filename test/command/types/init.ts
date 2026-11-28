import type { Env, Stdin } from "../../../src/app/types/app.ts";

/** One run of `kerpeten init` in a test: where it runs, the environment beside HOME and PATH, and standard input. */
export interface InitRun {
  readonly cwd: string;
  readonly home: string;
  readonly path: string;
  readonly env?: Env;
  readonly stdin: Stdin;
}

export interface InitResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
  readonly lines: readonly string[];
}

/** A standard input that records how often it was opened. */
export interface CountedStdin {
  readonly stdin: Stdin;
  readonly opened: () => number;
}

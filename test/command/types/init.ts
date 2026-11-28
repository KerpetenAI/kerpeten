import type { Class } from "@asenajs/ioc";
import type { Env, Stdin } from "../../../src/app/types/app.ts";

/**
 * One run of `kerpeten init` in a test: where it runs, the environment beside HOME and PATH, standard input, and the
 * components of the container, the CLI's when left out.
 */
export interface InitRun {
  readonly cwd: string;
  readonly home: string;
  readonly path: string;
  readonly env?: Env;
  readonly stdin: Stdin;
  readonly components?: readonly Class[];
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

import type { Target } from "../../build/types/build.ts";

/** The `os`, `cpu` and `libc` values npm uses to choose the package of one build target. */
export interface Platform {
  readonly os: string;
  readonly cpu: string;
  readonly libc?: string;
}

/** The fields every published package takes from the `package.json` of the repository. */
export interface PackageMeta {
  readonly version: string;
  readonly description: string;
  readonly license: string;
  readonly author: string;
}

export type Manifest = Readonly<Record<string, unknown>>;

/** Builds the binary of one target into a file. */
export type BinaryBuilder = (root: string, target: Target, outfile: string) => void;

/** One tarball that `npm pack` wrote. */
export interface PackedFile {
  readonly filename: string;
}

export interface CommandResult {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

import type { LlmAdapter } from "../../../../src/harness-kit/index.ts";

export interface RunInput {
  readonly label: string;
}

export interface InnerResult {
  readonly second: number;
}

export interface RunResult {
  readonly first: number;
  readonly second: number;
}

export interface BrokenRunInput {
  readonly llms: readonly LlmAdapter[];
}

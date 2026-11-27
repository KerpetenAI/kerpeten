import type { ToolOutcome, ToolSpec } from "../../../src/harness-kit/index.ts";

export interface Sandbox {
  readonly base: string;
  readonly repo: string;
  readonly outside: string;
}

export interface Session {
  readonly definitions: readonly ToolSpec[];
  execute(name: string, input: unknown): Promise<ToolOutcome>;
}

export interface SessionOptions {
  readonly repo?: string;
  readonly tracked?: readonly string[];
  readonly rgCommand?: string;
  readonly timeoutMs?: number;
  readonly clock?: () => number;
}

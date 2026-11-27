import type { Run } from "../run/Run.ts";
import type { CallUsage, LlmAdapter } from "./llm.ts";
import type { ToolClass } from "./tool.ts";

export type PartialReason = "tool_call_budget" | "time_budget" | "model_error";

export interface BudgetLimits {
  /** The most tool calls of one run; left out, the run has no tool call limit. */
  readonly maxToolCalls?: number;
  readonly stepDeadline: number;
  readonly finalizeDeadline: number;
}

export type HarnessLogFields = Readonly<Record<string, string | number | boolean | undefined>>;

export interface HarnessLogger {
  debug(message: string, fields?: HarnessLogFields): void;
  info(message: string, fields?: HarnessLogFields): void;
  warn(message: string, fields?: HarnessLogFields): void;
}

export type HarnessClass = abstract new (...args: never[]) => object;

export interface HarnessSpec {
  readonly name: string;
  readonly tools: readonly ToolClass[];
  /** Every permission the harness's tools can use, optional uses included. */
  readonly permissions: readonly string[];
}

export interface HarnessOptions {
  readonly llm: LlmAdapter;
  /** The run the tools run in; left out, the run that is open. */
  readonly run?: Run;
  readonly limits: BudgetLimits;
  readonly now: () => number;
  readonly log: HarnessLogger;
}

export interface UsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number | undefined;
  readonly cacheWriteTokens: number | undefined;
  readonly calls: number;
  readonly unknownCounts: number;
}

export interface HarnessRun<T> {
  readonly value: T | undefined;
  readonly partialReason: PartialReason | undefined;
  readonly error: string | undefined;
  readonly toolCalls: number;
  readonly steps: number;
  readonly usage: readonly CallUsage[];
  readonly totals: UsageTotals;
}

export type PermissionGroupMap = Readonly<Record<string, readonly string[]>> & {
  readonly all?: never;
};

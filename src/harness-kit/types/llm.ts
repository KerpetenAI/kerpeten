import type { z } from "zod";
import type { ToolSpec } from "./tool.ts";

export interface LlmToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface LlmToolResult {
  readonly id: string;
  readonly name: string;
  readonly output: unknown;
  readonly isError: boolean;
}

export interface CallUsage {
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly cacheReadTokens: number | undefined;
  readonly cacheWriteTokens: number | undefined;
}

export type LlmFailureKind = "model_error" | "aborted" | "invalid_output";

export interface ToolPhaseHooks {
  readonly runTool: (call: LlmToolCall) => Promise<LlmToolResult>;
  readonly onRefusedCall: (call: LlmToolCall, error: string) => void;
  readonly onCutOffCall: (call: LlmToolCall) => void;
  readonly shouldStop: () => boolean;
  readonly onUsage: (usage: CallUsage) => void;
}

export type ToolPhaseOutcome =
  | { readonly ok: true; readonly steps: number }
  | {
      readonly ok: false;
      readonly kind: Exclude<LlmFailureKind, "invalid_output">;
      readonly error: string;
      readonly steps: number;
    };

export type FinalizeOutcome<T> =
  | { readonly ok: true; readonly value: T; readonly usage: readonly CallUsage[] }
  | {
      readonly ok: false;
      readonly kind: LlmFailureKind;
      readonly error: string;
      readonly usage: readonly CallUsage[];
    };

export interface SessionInput {
  readonly instructions: string;
  readonly context: string;
  readonly tools: readonly ToolSpec[];
}

export interface LlmSession {
  runTools(hooks: ToolPhaseHooks, signal: AbortSignal): Promise<ToolPhaseOutcome>;
  finalize<T>(request: string, output: z.ZodType<T>, signal: AbortSignal): Promise<FinalizeOutcome<T>>;
}

export interface LlmAdapter {
  readonly provider: string;
  readonly model: string;
  start(input: SessionInput): LlmSession;
}

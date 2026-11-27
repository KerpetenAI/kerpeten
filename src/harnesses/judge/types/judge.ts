import type { z } from "zod";
import type { HarnessLogger, PartialReason, UsageTally } from "../../../harness-kit/index.ts";
import type { ReviewerFinding } from "../../review/types/review.ts";
import type { Deadlines, ProviderLlm, UsageEntry } from "../../types/harnesses.ts";
import type { judgeOutput } from "../schemas/judge-output-schema.ts";

export type JudgeOutput = z.infer<typeof judgeOutput>;

export interface JudgeRequest {
  readonly finding: ReviewerFinding;
  readonly patch: string;
  readonly commentLanguage: string;
  readonly promptVersion: string;
}

export type JudgeErrorReason = PartialReason | "invalid_input" | "harness_error";

export interface JudgeError {
  readonly reason: JudgeErrorReason;
  readonly message: string;
}

export interface JudgeRunCounts {
  readonly partialReason: PartialReason | undefined;
  readonly usage: UsageEntry;
  readonly unknownUsageCalls: number;
  readonly toolCalls: number;
  readonly steps: number;
  readonly promptVersion: string;
}

export interface JudgeLabels {
  readonly completed: true;
  readonly labels: JudgeOutput;
}

export interface JudgeFailure {
  readonly completed: false;
  readonly judgeError: JudgeError;
}

export type JudgeRun = JudgeRunCounts & (JudgeLabels | JudgeFailure);

export interface FileDiff {
  readonly text: string;
  readonly found: boolean;
}

export interface JudgeContextSpec {
  readonly MAX_DIFF_CHARS: number;
  readonly MAX_TEXT_CHARS: number;
  readonly MAX_EVIDENCE_ITEMS: number;
  readonly MAX_LINE_CHARS: number;
  readonly NO_DIFF: string;
  readonly DIFF_HEADER: string;
}

export interface JudgeStepLimits {
  readonly parallel: number;
  readonly maxToolCalls?: number;
  readonly durationMinutes: number;
}

export interface JudgeStepOptions {
  readonly llm: ProviderLlm;
  readonly limits: JudgeStepLimits;
  readonly now: () => number;
  readonly log: HarnessLogger;
  readonly nonce?: string;
}

export interface JudgeStepRequest {
  readonly findings: readonly ReviewerFinding[];
  readonly patch: string;
  readonly commentLanguage: string;
  readonly promptVersion: string;
}

export type FlowStepLimitReason = Extract<PartialReason, "time_budget">;

export interface JudgeVerdict {
  readonly labels: JudgeOutput;
}

export interface JudgeMiss {
  readonly judgeError: JudgeError;
}

export type JudgeOutcome = JudgeVerdict | JudgeMiss;

export interface JudgeSlot {
  readonly outcome: JudgeOutcome;
  readonly limit: FlowStepLimitReason | undefined;
}

export interface JudgeStepState {
  readonly request: JudgeStepRequest;
  readonly options: JudgeStepOptions;
  readonly window: Deadlines;
  readonly slots: (JudgeSlot | undefined)[];
  readonly usage: UsageTally;
  toolCalls: number;
  next: number;
}

export interface JudgeStepResult {
  readonly outcomes: readonly JudgeOutcome[];
  readonly usage: UsageEntry;
  readonly toolCalls: number;
  readonly unknownUsageCalls: number;
  readonly partialReason: FlowStepLimitReason | undefined;
}

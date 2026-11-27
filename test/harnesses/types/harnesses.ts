import type { JudgeOutput } from "../../../src/harnesses/judge/types/judge.ts";
import type { LogFields } from "../../../src/log/types/log.ts";

export interface CapturedLine {
  level: string;
  message: string;
  fields: LogFields;
}

export interface FakeJudgeAnswer {
  readonly name: string;
  readonly labels?: JudgeOutput | undefined;
  readonly error?: string;
  readonly throws?: boolean;
  readonly throwsAfterUsage?: boolean;
  readonly delayMs?: number;
  readonly inputTokens?: number;
  readonly steps?: number;
  readonly toolCalls?: number;
  readonly onRun?: () => void;
}

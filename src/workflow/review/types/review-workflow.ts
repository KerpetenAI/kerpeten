import type { KerpetenConfig } from "../../../capability/config/types/config.ts";
import type { JudgeStepResult } from "../../../harnesses/judge/types/judge.ts";
import type {
  DiscussedFinding,
  FilteredCandidates,
  JudgedFinding,
  LocalReviewResult,
  ReviewerRun,
} from "../../../harnesses/review/types/review.ts";
import type { ProviderLlm } from "../../../harnesses/types/harnesses.ts";
import type { Logger } from "../../../log/Logger.ts";

/**
 * What one review run is about, and what belongs to that run alone: its configuration, its two model clients and its
 * log. It is also the values of the run: run components read `repo`, `pathEnv` and `log` with `@RunValue`.
 */
export interface ReviewInput {
  readonly repo: string;
  readonly base?: string;
  readonly contextFile?: string;
  readonly group?: string;
  readonly pathEnv: string;
  readonly config: KerpetenConfig;
  readonly reviewerClient: ProviderLlm;
  readonly judgeClient: ProviderLlm;
  readonly log: Logger;
}

export interface ReportBasis {
  readonly baseSha: string;
  readonly headSha: string;
  readonly changedFiles: readonly string[];
  readonly promptVersion: string;
}

export type ReportHead = Pick<
  LocalReviewResult,
  "baseSha" | "headSha" | "changedFiles" | "dropped" | "clipped" | "promptVersion"
>;

export interface ReviewOutcome {
  readonly review: ReviewerRun;
  readonly candidates: FilteredCandidates;
  readonly judged: JudgeStepResult | undefined;
  readonly findings: readonly JudgedFinding[];
}

export interface ReviewChange extends ReportBasis {
  readonly start: number;
  readonly patch: string;
  readonly title: string;
  readonly description: string;
  readonly known: readonly DiscussedFinding[];
  readonly judgePromptVersion: string;
}

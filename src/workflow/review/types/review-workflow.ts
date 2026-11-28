import type { KerpetenConfig } from "../../../capability/config/types/config.ts";
import type { MergeRequest } from "../../../capability/platform/types/platform.ts";
import type { JudgeStepResult } from "../../../harnesses/judge/types/judge.ts";
import type {
  DiscussedFinding,
  FilteredCandidates,
  JudgedFinding,
  LocalReviewResult,
  ReviewerRun,
} from "../../../harnesses/review/types/review.ts";
import type { ProviderLlm } from "../../../harnesses/types/harnesses.ts";
import type { CommentPlan, PlannedFinding } from "../../../layer/comment/types/comment.ts";
import type { Logger } from "../../../log/Logger.ts";

/**
 * What one review run is about, and what belongs to that run alone: its configuration, its two model clients and its
 * log. It is also the values of the run: run components read `repo`, `pathEnv` and `log` with `@RunValue`.
 */
export interface ReviewInput {
  readonly repo: string;
  readonly base?: string;
  readonly mr?: number;
  readonly contextFile?: string;
  readonly extraContext?: string;
  readonly group?: string;
  readonly pathEnv: string;
  readonly config: KerpetenConfig;
  readonly reviewerClient: ProviderLlm;
  readonly judgeClient: ProviderLlm;
  readonly log: Logger;
}

/** The merge request a review is of, with the tenant it is reviewed for: together they say whose review of what it is. */
export interface ReviewedMergeRequest extends MergeRequest {
  readonly tenant: string;
}

/**
 * The result of the review workflow: the local review, and the merge request with the plan of its comments when the
 * review was of one. The action of a finding is then the one the comment plan gives it.
 */
export interface ReviewResult extends Omit<LocalReviewResult, "findings"> {
  readonly findings: readonly PlannedFinding[];
  readonly mergeRequest?: ReviewedMergeRequest;
  readonly commentPlan?: CommentPlan;
}

export interface ReportBasis {
  readonly baseSha: string;
  readonly headSha: string;
  readonly changedFiles: readonly string[];
  readonly promptVersion: string;
  readonly mergeRequest?: ReviewedMergeRequest;
}

export type ReportHead = Pick<
  ReviewResult,
  "baseSha" | "headSha" | "changedFiles" | "dropped" | "clipped" | "promptVersion" | "mergeRequest"
>;

export interface ReviewOutcome {
  readonly review: ReviewerRun;
  readonly candidates: FilteredCandidates;
  readonly judged: JudgeStepResult | undefined;
  readonly findings: readonly JudgedFinding[];
  readonly commentPlan: CommentPlan | undefined;
}

export interface ReviewChange extends ReportBasis {
  readonly start: number;
  readonly patch: string;
  readonly title: string;
  readonly description: string;
  readonly known: readonly DiscussedFinding[];
  readonly extraContext?: string;
  readonly judgePromptVersion: string;
}

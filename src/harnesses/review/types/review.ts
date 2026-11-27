import type { z } from "zod";
import type { Finding } from "../../../api/types/api.generated.ts";
import type { PartialReason } from "../../../harness-kit/index.ts";
import type { JudgeLabels, Scored, ScoredAction } from "../../../layer/scoring/types/scoring.ts";
import type { FlowStepLimitReason, JudgeOutput } from "../../judge/types/judge.ts";
import type { UsageEntry } from "../../types/harnesses.ts";
import type { reviewerFinding, reviewerOutput } from "../schemas/reviewer-output-schema.ts";

export type ReviewerFinding = z.infer<typeof reviewerFinding>;

export type ReviewerOutput = z.infer<typeof reviewerOutput>;

export interface DiscussedFinding {
  readonly title: string;
  readonly file: string;
  readonly reason?: string;
}

/** A rule file of the repository root as the reviewer gets it, with the other rule files that have the same text. */
export interface RuleFile {
  readonly name: string;
  readonly sameText: readonly string[];
  readonly text: string;
}

/** A rule file that is tracked at HEAD but was not read, and why. */
export interface SkippedRuleFile {
  readonly name: string;
  readonly reason: string;
}

export interface RuleFileSet {
  readonly files: readonly RuleFile[];
  readonly skipped: readonly SkippedRuleFile[];
}

export type RuleFileText =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

export interface ReviewerRequest {
  readonly title: string;
  readonly description: string;
  readonly patch: string;
  readonly changedFiles: readonly string[];
  readonly known: readonly DiscussedFinding[];
  readonly rules: readonly RuleFile[];
  readonly extraContext?: string;
  readonly commentLanguage: string;
  readonly promptVersion: string;
}

export interface ReviewerRun {
  readonly completed: boolean;
  readonly findings: readonly ReviewerFinding[];
  readonly partialReason: PartialReason | undefined;
  readonly error: string | undefined;
  readonly usage: UsageEntry;
  readonly unknownUsageCalls: number;
  readonly toolCalls: number;
  readonly steps: number;
  readonly promptVersion: string;
}

export interface ListBlock {
  readonly text: string;
  readonly omitted: number;
}

export interface ReviewerContextSpec {
  readonly MAX_PATCH_CHARS: number;
  readonly MAX_DISCUSSED_ITEMS: number;
  readonly MAX_DISCUSSED_CHARS: number;
  readonly MAX_TEXT_CHARS: number;
  readonly MAX_CHANGED_FILES: number;
  readonly MAX_CHANGED_FILES_CHARS: number;
  readonly MAX_RULE_FILE_CHARS: number;
}

export type DropReason = "bad_path" | "no_file" | "unreadable_file" | "bad_range" | "line_outside" | "blank_range";

export interface LocalReviewResult {
  readonly baseSha: string;
  readonly headSha: string;
  readonly changedFiles: readonly string[];
  readonly findings: readonly JudgedFinding[];
  readonly dropped: Readonly<Partial<Record<DropReason, number>>>;
  readonly clipped: number;
  readonly partial: boolean;
  readonly partialReason?: PartialReason;
  readonly reviewerPartialReason?: PartialReason;
  readonly judgePartialReason?: FlowStepLimitReason;
  readonly failure?: string;
  readonly usage: readonly UsageEntry[];
  readonly toolCalls: number;
  readonly judgeToolCalls: number;
  readonly promptVersion: string;
}

export type JudgeLabelFields = JudgeLabels & Pick<JudgeOutput, "rationale"> & Scored;

export interface JudgeErrorFields {
  readonly judge_error: string;
  readonly action: Extract<ScoredAction, "stored">;
}

export type JudgedFinding = ReviewerFinding & (JudgeLabelFields | JudgeErrorFields);

export interface FilteredCandidates {
  readonly kept: readonly ReviewerFinding[];
  readonly dropped: Readonly<Partial<Record<DropReason, number>>>;
  readonly clipped: number;
}

export type CandidateFile = readonly string[] | "missing" | "unreadable";

export type CandidateLines = Pick<Finding, "start_line" | "end_line">;

export type CandidateCheck<F extends CandidateLines> =
  | { readonly kind: "keep"; readonly finding: F; readonly clipped: boolean }
  | { readonly kind: "drop"; readonly reason: DropReason };

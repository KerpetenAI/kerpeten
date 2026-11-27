import {
  type After,
  type OptionalGap,
  type PermissionGrant,
  PermissionGroupError,
  Workflow,
  WorkflowBase,
} from "../../harness-kit/index.ts";
import { deadlines } from "../../harnesses/harnesses-utils.ts";
import { ReviewInputError } from "../../harnesses/review/ReviewInputError.ts";
import type { LocalReviewResult } from "../../harnesses/review/types/review.ts";
import type { Deadlines } from "../../harnesses/types/harnesses.ts";
import { ReviewReport } from "./ReviewReport.ts";
import { CandidateStep } from "./step/CandidateStep.ts";
import { ChangeStep } from "./step/ChangeStep.ts";
import { JudgeStep } from "./step/JudgeStep.ts";
import { ReviewerStep } from "./step/ReviewerStep.ts";
import { ScoreStep } from "./step/ScoreStep.ts";
import type { ReviewInput } from "./types/review-workflow.ts";

/**
 * The local review: reads the change, runs the reviewer, filters its findings, judges and scores the kept ones and
 * reports the result. An empty change ends after the first flow step. The kit checks the run's grant against the
 * reviewer and the judge before git is touched. Expected failures and partial runs are part of the result; a wrong
 * input, a refused grant among them, throws `ReviewInputError`.
 */
@Workflow({
  name: "review",
  description:
    "Reviews the change between the base branch and HEAD: reads the change, runs the reviewer, keeps the findings that point at real lines, has the judge check them, scores them and reports the result.",
  steps: [ChangeStep, ReviewerStep, CandidateStep, JudgeStep, ScoreStep],
})
export class ReviewWorkflow extends WorkflowBase<ReviewInput, After<typeof ScoreStep>, LocalReviewResult> {
  public static deadlines(start: number, minutes: number): Deadlines {
    return deadlines(start, minutes);
  }

  protected override group(input: ReviewInput): string | undefined {
    return input.group;
  }

  /** Logs each optional use of the reviewer's and the judge's tools that the run's grant does not give. */
  protected override admit(input: ReviewInput, _grant: PermissionGrant, gaps: readonly OptionalGap[]): void {
    for (const gap of gaps) input.log.info("optional capability not given", { ...gap });
  }

  /** A permission group the program does not have, or one the kit refused, is a wrong input; every other error is thrown as it is. */
  protected override rescue(error: unknown): never {
    if (error instanceof PermissionGroupError) throw new ReviewInputError(error.message);

    throw error;
  }

  protected finish(state: After<typeof ScoreStep>): LocalReviewResult {
    return ReviewReport.of(state.change, state);
  }
}

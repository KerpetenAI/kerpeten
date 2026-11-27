import type { LocalReviewResult } from "../../harnesses/review/types/review.ts";
import type { ReportBasis, ReportHead, ReviewOutcome } from "./types/review-workflow.ts";

export class ReviewReport {
  public static empty(basis: ReportBasis): LocalReviewResult {
    return { ...ReviewReport.head(basis), findings: [], partial: false, usage: [], toolCalls: 0, judgeToolCalls: 0 };
  }

  public static of(basis: ReportBasis, outcome: ReviewOutcome): LocalReviewResult {
    const { review, candidates, judged, findings } = outcome;

    const partialReason = review.partialReason ?? judged?.partialReason;

    return {
      ...ReviewReport.head(basis),
      findings,
      dropped: candidates.dropped,
      clipped: candidates.clipped,
      partial: partialReason !== undefined,
      ...(partialReason === undefined ? {} : { partialReason }),
      ...(review.partialReason === undefined ? {} : { reviewerPartialReason: review.partialReason }),
      ...(judged?.partialReason === undefined ? {} : { judgePartialReason: judged.partialReason }),
      ...(review.completed ? {} : { failure: review.error ?? "no structured result" }),
      usage: judged === undefined ? [review.usage] : [review.usage, judged.usage],
      toolCalls: review.toolCalls,
      judgeToolCalls: judged?.toolCalls ?? 0,
    };
  }

  private static head(basis: ReportBasis): ReportHead {
    const { baseSha, headSha, changedFiles, promptVersion } = basis;

    return { baseSha, headSha, changedFiles, dropped: {}, clipped: 0, promptVersion };
  }
}

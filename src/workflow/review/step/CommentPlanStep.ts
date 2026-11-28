import { Inject } from "@asenajs/ioc";
import { type After, FlowStep, FlowStepBase } from "../../../harness-kit/index.ts";
import { CommentableLines } from "../../../layer/comment/CommentableLines.ts";
import { CommentPlanner } from "../../../layer/comment/CommentPlanner.ts";
import type { ScoreStep } from "./ScoreStep.ts";

/**
 * Plans the comments of a review of a merge request: gives every finding the action a posted review would take and
 * writes the texts of the line comments and of the summary comment. It writes nothing to the merge request. A review
 * of no merge request has no plan, and neither has one whose reviewer gave no result, because there is nothing true to
 * say about it.
 */
@FlowStep({
  name: "comment-plan",
  description:
    "Plans the comments of a review of a merge request: the action of every finding and the texts of the line comments and the summary comment, without writing them; a review without a merge request has no plan.",
})
export class CommentPlanStep extends FlowStepBase {
  @Inject(CommentPlanner)
  private readonly planner!: CommentPlanner;

  public execute(state: After<typeof ScoreStep>) {
    const { written, change, config, review, judged, log } = state;

    if (written === undefined || !review.completed) return { commentPlan: undefined };

    const partialReason = review.partialReason ?? judged?.partialReason;

    const commentPlan = this.planner.plan({
      findings: state.findings,
      lines: CommentableLines.of(change.patch),
      written,
      headSha: change.headSha,
      maxInlineComments: config.limits.max_inline_comments,
      language: config.comment_language,
      ...(partialReason === undefined ? {} : { partialReason }),
    });

    const cut = commentPlan.lineComments.filter((comment) => comment.cut).length;

    log.info("comment plan", { ...commentPlan.counts });

    if (cut > 0) log.warn("line comments cut to the comment limit", { comments: cut });

    if (commentPlan.summary.omitted > 0) {
      log.warn("summary comment does not show every finding", { omitted: commentPlan.summary.omitted });
    }

    return { commentPlan };
  }
}

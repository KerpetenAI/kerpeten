import { Inject } from "@asenajs/ioc";
import { type After, FlowStep, FlowStepBase, Use } from "@kerpetensh/harness-kit";
import { CommentRef } from "../../../capability/platform/CommentRef.ts";
import { PlatformChoice } from "../../../capability/platform/PlatformChoice.ts";
import type { PlatformLineComment } from "../../../capability/platform/types/platform.ts";
import { CommentMarker } from "../../../layer/comment/CommentMarker.ts";
import { CommentPlanner } from "../../../layer/comment/CommentPlanner.ts";
import type { LineComment, WrittenComment } from "../../../layer/comment/types/comment.ts";
import { terminalLine } from "../../../text/text-utils.ts";
import type { CommentWrite } from "../types/review-workflow.ts";
import type { CommentPlanStep } from "./CommentPlanStep.ts";

/**
 * Writes the planned comments to the merge request, as the last flow step of a review, through the writer the run's
 * platform choice gives. With `--dry-run`, and for a review that has no plan, it writes nothing and asks for no
 * writer.
 *
 * The order is fixed:
 *
 * 1. The line comments go to the platform in one write. Each comes back written with its ref, refused, or failed.
 * 2. The plan is made final from that, by the comment planner: a refused finding goes to the summary, a failed one is
 *    stored, and the summary text is written again so that it says what is really on the merge request.
 * 3. The summary comment is written last. There is one per merge request: when the comments read at the start hold a
 *    summary comment of Kerpeten, known by its marker, that one gets the new text, otherwise one is made. A review
 *    without findings writes it too. When it cannot be written, its findings are stored.
 *
 * A comment that cannot be written does not stop the others. Each is logged and gives one line of `failures`, which
 * the command reports and ends with 1 for. A refused line comment is no failure: its finding is in the summary. A
 * second run writes no line comment twice, because the comments of the first are known by their markers.
 */
@FlowStep({
  name: "comment-write",
  description:
    "Writes the planned comments to the merge request: the line comments in one write, then the one summary comment, made or updated; a line comment the platform refuses goes to the summary and one that fails leaves its finding stored; with --dry-run, or without a plan, it writes nothing.",
})
export class CommentWriteStep extends FlowStepBase {
  @Inject(CommentPlanner)
  private readonly planner!: CommentPlanner;

  @Use(PlatformChoice)
  private readonly platforms!: PlatformChoice;

  /** A planned line comment as the platform takes it, with the marker that ends its text. */
  private static lineComment(comment: LineComment): PlatformLineComment {
    const { file, startLine, endLine, body } = comment;
    const marker = CommentMarker.read(body);

    if (marker === undefined) throw new Error(`the line comment on ${CommentWriteStep.place(comment)} has no marker`);

    return { file, startLine, endLine, body, marker: marker.line() };
  }

  private static place(comment: LineComment): string {
    const { startLine, endLine } = comment;

    return `${terminalLine(comment.file)}:${startLine === endLine ? startLine : `${startLine}-${endLine}`}`;
  }

  /**
   * The refs of the summary comments of Kerpeten that are on the merge request: the comments of its conversation that
   * end with the summary's marker, in the order they were read. Any other comment with that marker is somebody's copy.
   */
  private static summaries(written: readonly WrittenComment[]): string[] {
    return written
      .filter((comment) => comment.mark.kind === "summary" && CommentRef.parse(comment.ref).inConversation)
      .map((comment) => comment.ref);
  }

  public async execute(state: After<typeof CommentPlanStep>) {
    const { commentPlan, mergeRequest, written, change, config, review, judged, log } = state;

    if (state.dryRun || commentPlan === undefined || mergeRequest === undefined || written === undefined) {
      return { commentWrite: undefined };
    }

    const writer = await this.platforms.writer();

    if (writer === undefined) throw new Error(`no writer for the platform ${mergeRequest.kind}`);

    const { number } = mergeRequest;
    const failures: string[] = [];
    const planned = commentPlan.lineComments;

    const lines = await writer.writeLineComments(
      number,
      change.headSha,
      planned.map((comment) => CommentWriteStep.lineComment(comment)),
    );

    for (const [index, outcome] of lines.outcomes.entries()) {
      const comment = planned[index];
      const place = comment === undefined ? "?" : CommentWriteStep.place(comment);

      if (outcome.kind === "refused") {
        log.warn("line comment refused, its finding goes to the summary", { place, reason: outcome.reason });
      }

      if (outcome.kind === "failed") {
        log.error("line comment failed, its finding is stored", { place, error: outcome.message });
        failures.push(`line comment on ${place}: ${terminalLine(outcome.message)}`);
      }
    }

    for (const problem of lines.problems) log.warn("line comments written", { problem });

    const partialReason = review.partialReason ?? judged?.partialReason;

    const afterLines = this.planner.afterLineComments({
      plan: commentPlan,
      results: lines.outcomes,
      headSha: change.headSha,
      language: config.comment_language,
      ...(partialReason === undefined ? {} : { partialReason }),
    });

    const [existing, ...others] = CommentWriteStep.summaries(written);

    if (others.length > 0) {
      log.warn("more than one summary comment is on the merge request, the first is updated", {
        updated: existing,
        left: others.join(","),
      });
    }

    const summary = await writer.writeSummary(number, afterLines.summary.body, existing);

    if (summary.kind === "failed") {
      log.error("summary comment failed, its findings are stored", { error: summary.message });
      failures.push(`summary comment: ${terminalLine(summary.message)}`);
    }

    const plan = this.planner.afterSummary(afterLines, summary.kind === "written" ? summary.ref : undefined);

    log.info("comments written", {
      line_comments: plan.lineComments.length,
      refused: lines.outcomes.filter((outcome) => outcome.kind === "refused").length,
      failed: lines.outcomes.filter((outcome) => outcome.kind === "failed").length,
      summary: summary.kind === "failed" ? "failed" : summary.updated ? "updated" : "created",
      summary_ref: summary.kind === "failed" ? undefined : summary.ref,
    });

    const commentWrite: CommentWrite = { plan, failures };

    return { commentWrite };
  }
}

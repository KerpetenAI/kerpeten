import { Service } from "@asenajs/ioc";
import type { JudgedFinding } from "../../harnesses/review/types/review.ts";
import type { CommentableLines } from "./CommentableLines.ts";
import { CommentTexts } from "./CommentTexts.ts";
import { CommentWords } from "./CommentWords.ts";
import type { CommentPlan, CommentPlanInput, PlannedAction, PlannedFinding, RankedFinding } from "./types/comment.ts";
import { WrittenFindings } from "./WrittenFindings.ts";

/**
 * Decides what a review would write to its merge request: one action for every judged finding, and the texts of the
 * line comments and of the summary comment. Pure: no network, no clock, no model and no randomness, so the same input
 * always gives the same plan. It writes nothing.
 *
 * The rules, in this order:
 *
 * 1. A finding the scorer stored stays stored: a refuted one, one the judge did not label and one under the summary
 *    threshold. It is never written.
 * 2. A finding that a line comment of Kerpeten on the merge request already stands for, at the same commit, file and
 *    lines, is a duplicate and is not written again.
 * 3. A finding the scorer gave a line comment gets one when its whole range lies inside one hunk of its file on the
 *    new side of the diff; otherwise it goes to the summary.
 * 4. At most `maxInlineComments` line comments are written in one run. When more findings qualify, the ones with the
 *    highest score keep their line and the others go to the summary.
 * 5. A finding the scorer gave the summary goes to the summary.
 *
 * Where scores are equal, the file, then the first line, then the title decide, and after them the last line, the
 * body, the fix and the category, so the order never depends on the order the findings came in. The line comments and
 * the findings of the summary are in that order, highest score first.
 */
@Service("kerpeten:comment-planner")
export class CommentPlanner {
  public plan(input: CommentPlanInput): CommentPlan {
    const { findings, lines, headSha, maxInlineComments } = input;

    if (!Number.isSafeInteger(maxInlineComments) || maxInlineComments < 0) {
      throw new RangeError(`not a count of line comments: ${String(maxInlineComments)}`);
    }

    const texts = new CommentTexts(CommentWords.of(input.language), headSha);
    const written = new WrittenFindings(input.written);

    const first = findings.map((finding) => ({
      finding,
      action: CommentPlanner.first(finding, written.has(headSha, finding), lines),
    }));

    const overLimit = new Set(
      first
        .filter((entry) => entry.action === "inline")
        .sort((one, other) => CommentPlanner.byRank(one.finding, other.finding))
        .slice(maxInlineComments),
    );

    const planned = first.map((entry) =>
      CommentPlanner.planned(entry.finding, overLimit.has(entry) ? "summary" : entry.action),
    );

    const inline = CommentPlanner.ranked(planned, "inline");
    const listed = CommentPlanner.ranked(planned, "summary");
    const duplicate = planned.filter((finding) => finding.action === "suppressed_duplicate").length;

    return {
      findings: planned,
      lineComments: inline.map((finding) => texts.lineComment(finding)),
      summary: texts.summary(listed, {
        lineComments: inline.length,
        alreadyWritten: duplicate,
        ...(input.partialReason === undefined ? {} : { partialReason: input.partialReason }),
      }),
      counts: {
        inline: inline.length,
        summary: listed.length,
        duplicate,
        stored: planned.filter((finding) => finding.action === "stored").length,
      },
    };
  }

  /** The action of a finding before the limit of line comments is applied. */
  private static first(finding: JudgedFinding, written: boolean, lines: CommentableLines): PlannedAction {
    if (finding.action === "stored") return "stored";

    if (written) return "suppressed_duplicate";

    if (finding.action === "summary") return "summary";

    return lines.holds(finding.file, finding.start_line, finding.end_line) ? "inline" : "summary";
  }

  private static planned(finding: JudgedFinding, action: PlannedAction): PlannedFinding {
    return "judge_error" in finding ? finding : { ...finding, action };
  }

  private static ranked(findings: readonly PlannedFinding[], action: PlannedAction): PlannedFinding[] {
    return findings.filter((finding) => finding.action === action).sort(CommentPlanner.byRank);
  }

  private static byRank(first: RankedFinding, second: RankedFinding): number {
    return (
      CommentPlanner.score(second) - CommentPlanner.score(first) ||
      CommentPlanner.order(first.file, second.file) ||
      first.start_line - second.start_line ||
      CommentPlanner.order(first.title, second.title) ||
      first.end_line - second.end_line ||
      CommentPlanner.order(first.body, second.body) ||
      CommentPlanner.order(first.fix, second.fix) ||
      CommentPlanner.order(first.category, second.category)
    );
  }

  private static score(finding: RankedFinding): number {
    return "judge_error" in finding ? 0 : finding.score;
  }

  /** The order of two texts by their characters, the same on every machine and in every language setting. */
  private static order(first: string, second: string): number {
    if (first === second) return 0;

    return first < second ? -1 : 1;
  }
}

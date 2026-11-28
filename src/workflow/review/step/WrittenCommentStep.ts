import { GitHubPlatform } from "../../../capability/platform/GitHubPlatform.ts";
import { PlatformError } from "../../../capability/platform/PlatformError.ts";
import type { Platform, PlatformComment, PlatformComments } from "../../../capability/platform/types/platform.ts";
import { type After, FlowStep, FlowStepBase, Use } from "../../../harness-kit/index.ts";
import { ReviewInputError } from "../../../harnesses/review/ReviewInputError.ts";
import { CommentMarker } from "../../../layer/comment/CommentMarker.ts";
import type { WrittenComment } from "../../../layer/comment/types/comment.ts";
import { terminalLine } from "../../../text/text-utils.ts";
import type { ChangeStep } from "./ChangeStep.ts";

/**
 * Reads the comments that are already on the merge request and keeps the ones Kerpeten wrote, so the comment plan
 * knows which findings are written. A comment is Kerpeten's by the hidden marker that ends its text, never by its
 * author: a local run writes from the user's own account.
 *
 * It runs after the change is read and before the reviewer, so the cheap checks of the working copy come first and a
 * platform that cannot give the comments stops the review before any model is called. When the comments could not all
 * be read, the review cannot tell what is written and would write it twice, so it stops with the platform's error. A
 * review of no merge request reads nothing.
 */
@FlowStep({
  name: "written-comments",
  description:
    "Reads the comments already on the merge request and keeps the ones Kerpeten wrote, known by their hidden marker, before any model call; comments that cannot all be read stop the review, and a review without a merge request reads none.",
})
export class WrittenCommentStep extends FlowStepBase {
  @Use(GitHubPlatform)
  private readonly platform!: Platform;

  private static written(comments: readonly PlatformComment[]): WrittenComment[] {
    return comments.flatMap((comment) => {
      const marker = CommentMarker.read(comment.body);

      return marker === undefined ? [] : [{ kind: comment.kind, mark: marker.mark }];
    });
  }

  public async execute(state: After<typeof ChangeStep>) {
    const { mergeRequest, log } = state;

    const written: readonly WrittenComment[] | undefined =
      mergeRequest === undefined ? undefined : WrittenCommentStep.written(await this.read(mergeRequest.number));

    if (written !== undefined) {
      log.info("merge request comments read", {
        kerpeten_line: written.filter((comment) => comment.kind === "line" && comment.mark.kind === "finding").length,
        kerpeten_summary: written.filter((comment) => comment.mark.kind === "summary").length,
      });
    }

    return { written };
  }

  private async read(number: number): Promise<readonly PlatformComment[]> {
    let read: PlatformComments;

    try {
      read = await this.platform.comments(number);
    } catch (error) {
      if (!(error instanceof PlatformError)) throw error;

      const message = `--mr ${number}: ${error.message}`;

      throw error.kind === "failed" ? new PlatformError("failed", message) : new ReviewInputError(message);
    }

    if (read.complete) return read.comments;

    const problems = read.problems.map((problem) => terminalLine(problem)).join("; ");

    throw new PlatformError(
      "failed",
      `--mr ${number}: the comments of the merge request could not all be read, so the review cannot tell which findings are already written: ${problems}`,
    );
  }
}

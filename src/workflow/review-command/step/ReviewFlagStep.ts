import { Inject } from "@asenajs/ioc";
import { ExitCode, FlowStep, FlowStepBase } from "@kerpetensh/harness-kit";
import { Logger } from "../../../log/Logger.ts";
import type { ReviewFlags } from "../types/review-command.ts";

/**
 * Opens the command's log and refuses what this build cannot do: a review without `--dry-run` ends with 1 through the
 * log, `--full` ends with 2.
 */
@FlowStep({
  name: "review-flags",
  description: "Opens the log of the review command and refuses a review without --dry-run and one with --full.",
})
export class ReviewFlagStep extends FlowStepBase {
  @Inject(Logger)
  private readonly logger!: Logger;

  public execute(state: ReviewFlags) {
    const log = this.logger.child({ command: this.command.name });

    if (!state.dryRun) {
      log.error("review without --dry-run is not implemented in this build");

      return this.end(ExitCode.FAILED);
    }

    if (state.full) {
      return this.end(
        this.command.fail(
          ExitCode.USAGE,
          "--full is not supported in this build; incremental review does not exist yet, so every review already covers the whole change",
        ),
      );
    }

    return { log };
  }
}

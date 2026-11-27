import { Inject } from "@asenajs/ioc";
import { Names } from "../../../app/Names.ts";
import type { Instances } from "../../../app/types/app.ts";
import { type After, FlowStep, FlowStepBase, HarnessWiring } from "../../../harness-kit/index.ts";
import { deadlines } from "../../../harnesses/harnesses-utils.ts";
import { ReviewerHarness } from "../../../harnesses/review/ReviewerHarness.ts";
import type { ChangeStep } from "./ChangeStep.ts";

/** Runs the reviewer on the change in the run of the permission group, in the time counted from the start. */
@FlowStep({
  name: "reviewer",
  description:
    "Runs the reviewer model on the change with the tools of the permission group, within the time counted from the start of the review.",
})
export class ReviewerStep extends FlowStepBase {
  @Inject(Names.NOW)
  private readonly now!: Instances[Names.NOW];

  @Inject(ReviewerHarness)
  private readonly reviewer!: ReviewerHarness;

  public async execute(state: After<typeof ChangeStep>) {
    const { config, reviewerClient, log, change } = state;
    const { grant } = this.run;
    const permissions = HarnessWiring.given(ReviewerHarness, grant);

    log.info("permission group", { group: grant.group, permissions: permissions.join(", ") });

    const review = await this.reviewer.review(
      {
        title: change.title,
        description: change.description,
        patch: change.patch,
        changedFiles: change.changedFiles,
        known: change.known,
        commentLanguage: config.comment_language,
        promptVersion: change.promptVersion,
      },
      {
        llm: reviewerClient,
        limits: {
          ...(config.limits.max_tool_calls === undefined ? {} : { maxToolCalls: config.limits.max_tool_calls }),
          ...deadlines(change.start, config.limits.max_duration_minutes),
        },
        now: this.now,
        log,
      },
    );

    log.info("reviewer ended", {
      completed: review.completed,
      findings: review.findings.length,
      steps: review.steps,
      tool_calls: review.toolCalls,
      ms: this.now() - change.start,
      partial: review.partialReason,
    });

    return { review };
  }
}

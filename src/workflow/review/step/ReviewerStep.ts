import { Inject } from "@asenajs/ioc";
import { Names } from "../../../app/Names.ts";
import type { Instances } from "../../../app/types/app.ts";
import { type After, FlowStep, FlowStepBase, HarnessWiring, Use } from "../../../harness-kit/index.ts";
import { deadlines } from "../../../harnesses/harnesses-utils.ts";
import { ReviewerHarness } from "../../../harnesses/review/ReviewerHarness.ts";
import { RuleFiles } from "../../../harnesses/review/RuleFiles.ts";
import type { ChangeStep } from "./ChangeStep.ts";

/**
 * Reads the project's rule files and runs the reviewer on the change and the rules in the run of the permission group,
 * in the time counted from the start. A rule file that is tracked but cannot be read is logged as a warning.
 */
@FlowStep({
  name: "reviewer",
  description:
    "Reads the project's rule files and runs the reviewer model on the change with the tools of the permission group, within the time counted from the start of the review.",
})
export class ReviewerStep extends FlowStepBase {
  @Inject(Names.NOW)
  private readonly now!: Instances[Names.NOW];

  @Inject(ReviewerHarness)
  private readonly reviewer!: ReviewerHarness;

  @Use(RuleFiles)
  private readonly ruleFiles!: RuleFiles;

  public async execute(state: After<typeof ChangeStep>) {
    const { config, reviewerClient, log, change } = state;
    const { grant } = this.run;
    const permissions = HarnessWiring.given(ReviewerHarness, grant);

    log.info("permission group", { group: grant.group, permissions: permissions.join(", ") });

    const rules = await this.ruleFiles.read();

    for (const skipped of rules.skipped) log.warn("rule file not read", { file: skipped.name, reason: skipped.reason });

    const review = await this.reviewer.review(
      {
        title: change.title,
        description: change.description,
        patch: change.patch,
        changedFiles: change.changedFiles,
        known: change.known,
        rules: rules.files,
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

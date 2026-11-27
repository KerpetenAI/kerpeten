import { Inject } from "@asenajs/ioc";
import { type After, ExitCode, FlowStep, FlowStepBase } from "../../../harness-kit/index.ts";
import { ReviewSetup } from "../ReviewSetup.ts";
import type { ReviewFlagStep } from "./ReviewFlagStep.ts";

/**
 * Gets the review ready before any model is called; each problem is one line, and then the command ends with 2. What
 * it adds is what the local review workflow, the next in the chain, takes as its input.
 */
@FlowStep({
  name: "review-setup",
  description:
    "Finds the repository, loads its configuration, checks the model keys and builds both model clients; each problem the user can fix ends the review before any model call.",
})
export class ReviewSetupStep extends FlowStepBase {
  @Inject(ReviewSetup)
  private readonly setup!: ReviewSetup;

  public async execute(state: After<typeof ReviewFlagStep>) {
    const prepared = await this.setup.prepare();

    if (!prepared.ok) {
      for (const problem of prepared.problems) this.command.report(problem);

      return this.end(ExitCode.USAGE);
    }

    const { config, configHash } = prepared.review;
    const { reviewer, judge } = config.models;

    state.log.info("review started", {
      mode: "local-branch",
      provider: reviewer.provider,
      model: reviewer.model,
      base_url: reviewer.provider === "chatgpt" ? undefined : reviewer.base_url,
      effort: reviewer.effort,
      config_hash: configHash,
      judge_provider: judge.provider,
      judge_model: judge.model,
    });

    return prepared.review;
  }
}

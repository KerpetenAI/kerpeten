import { Inject } from "@asenajs/ioc";
import { type After, FlowStep, FlowStepBase } from "@kerpetensh/harness-kit";
import type { JudgeOutcome } from "../../../harnesses/judge/types/judge.ts";
import type { JudgedFinding, ReviewerFinding } from "../../../harnesses/review/types/review.ts";
import { Scorer } from "../../../layer/scoring/Scorer.ts";
import type { ScoringConfig } from "../../../layer/scoring/types/scoring.ts";
import type { JudgeStep } from "./JudgeStep.ts";

/**
 * Gives every kept finding the judge's labels, its score by the scoring config of the run and its action; a finding the
 * judge did not label keeps its judge error and is stored.
 */
@FlowStep({
  name: "score",
  description:
    "Gives every kept finding the judge's labels, a score and the action a posted review would take; a finding the judge did not label is stored with its judge error.",
})
export class ScoreStep extends FlowStepBase {
  @Inject(Scorer)
  private readonly scorer!: Scorer;

  public execute(state: After<typeof JudgeStep>) {
    const { candidates, judged, config } = state;

    const findings = candidates.kept.map((finding, index) => this.scored(finding, judged?.outcomes[index], config));

    return { findings };
  }

  private scored(finding: ReviewerFinding, outcome: JudgeOutcome | undefined, config: ScoringConfig): JudgedFinding {
    if (outcome === undefined)
      return { ...finding, judge_error: "harness_error: the finding was not judged", action: "stored" };

    if ("judgeError" in outcome) {
      return {
        ...finding,
        judge_error: `${outcome.judgeError.reason}: ${outcome.judgeError.message}`,
        action: "stored",
      };
    }

    const { verdict, priority, nature, fix_effort, rationale } = outcome.labels;
    const { score, action } = this.scorer.rate(outcome.labels, config);

    return { ...finding, verdict, priority, nature, fix_effort, rationale, score, action };
  }
}

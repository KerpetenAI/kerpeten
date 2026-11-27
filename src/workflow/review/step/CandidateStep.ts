import { type After, FlowStep, FlowStepBase, Use } from "../../../harness-kit/index.ts";
import { CandidateFilter } from "../../../harnesses/review/CandidateFilter.ts";
import type { ReviewerStep } from "./ReviewerStep.ts";

/** Keeps the reviewer's findings that point at real lines of the files at HEAD and counts the dropped ones. */
@FlowStep({
  name: "candidates",
  description:
    "Keeps the reviewer's findings that point at real lines of the files at HEAD and counts the dropped ones.",
})
export class CandidateStep extends FlowStepBase {
  @Use(CandidateFilter)
  private readonly filter!: CandidateFilter;

  public async execute(state: After<typeof ReviewerStep>) {
    const candidates = await this.filter.filter(state.review.findings);

    return { candidates };
  }
}

import { Inject } from "@asenajs/ioc";
import { type After, FlowStep, FlowStepBase } from "../../../harness-kit/index.ts";
import { ReviewPrinter } from "../ReviewPrinter.ts";
import type { ReviewOutcomeStep } from "./ReviewOutcomeStep.ts";

/** Prints the result of the review on stdout, as text or, with `--json`, as JSON. */
@FlowStep({ name: "review-print", description: "Prints the result of the review on stdout, as text or as JSON." })
export class ReviewPrintStep extends FlowStepBase {
  @Inject(ReviewPrinter)
  private readonly printer!: ReviewPrinter;

  public execute(state: After<typeof ReviewOutcomeStep>) {
    this.printer.print(state, state.json);

    return {};
  }
}

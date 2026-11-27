import { type After, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { SwallowingStep } from "./SwallowingStep.ts";
import type { BrokenRunInput } from "./types/run.ts";

@Workflow({
  name: "broken-run",
  description: "Runs harnesses whose tool takes a source that cannot be built, in a flow step that keeps their errors.",
  steps: [SwallowingStep],
})
export class BrokenRunWorkflow extends WorkflowBase<BrokenRunInput, After<typeof SwallowingStep>, number> {
  protected finish(state: After<typeof SwallowingStep>): number {
    return state.ended;
  }
}

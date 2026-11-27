import { type After, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { SecondRunStep } from "./SecondRunStep.ts";
import type { InnerResult, RunInput } from "./types/run.ts";

@Workflow({ name: "inner-run", description: "Reads the counted service in a flow step.", steps: [SecondRunStep] })
export class InnerRunWorkflow extends WorkflowBase<RunInput, After<typeof SecondRunStep>, InnerResult> {
  protected finish(state: After<typeof SecondRunStep>): InnerResult {
    return { second: state.second };
  }
}

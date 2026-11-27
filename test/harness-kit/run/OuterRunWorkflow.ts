import { type After, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { FirstRunStep } from "./FirstRunStep.ts";
import { InnerRunWorkflow } from "./InnerRunWorkflow.ts";
import type { InnerResult, RunInput, RunResult } from "./types/run.ts";

@Workflow({
  name: "outer-run",
  description: "Reads the counted service in a flow step and in a nested workflow.",
  steps: [FirstRunStep, InnerRunWorkflow],
})
export class OuterRunWorkflow extends WorkflowBase<RunInput, After<typeof FirstRunStep> & InnerResult, RunResult> {
  protected finish(state: After<typeof FirstRunStep> & InnerResult): RunResult {
    return { first: state.first, second: state.second };
  }
}

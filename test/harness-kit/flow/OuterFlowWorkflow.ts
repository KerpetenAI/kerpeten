import { type After, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { FlowWorkflow } from "./FlowWorkflow.ts";
import { OuterIndexFlowStep } from "./OuterIndexFlowStep.ts";
import type { FlowResult, OuterFlowResult } from "./types/flow.ts";

@Workflow({
  name: "outer-flow",
  description: "Takes the flow source, then runs the flow workflow.",
  steps: [OuterIndexFlowStep, FlowWorkflow],
})
export class OuterFlowWorkflow extends WorkflowBase<
  { readonly label: string },
  After<typeof OuterIndexFlowStep> & FlowResult,
  OuterFlowResult
> {
  protected finish(state: After<typeof OuterIndexFlowStep> & FlowResult): OuterFlowResult {
    return { outer: state.outer, indexed: state.indexed };
  }
}

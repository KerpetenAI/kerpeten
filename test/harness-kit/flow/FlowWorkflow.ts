import { type After, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { IndexFlowStep } from "./IndexFlowStep.ts";
import type { FlowInput, FlowResult } from "./types/flow.ts";

@Workflow({ name: "flow", description: "Runs the flow flow step.", steps: [IndexFlowStep] })
export class FlowWorkflow extends WorkflowBase<FlowInput, After<typeof IndexFlowStep>, FlowResult> {
  protected finish(state: After<typeof IndexFlowStep>): FlowResult {
    return { indexed: state.indexed };
  }
}

import { type After, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { BrokenIndexFlowStep } from "./BrokenIndexFlowStep.ts";

@Workflow({ name: "broken-flow", description: "Runs the broken flow flow step.", steps: [BrokenIndexFlowStep] })
export class BrokenFlowWorkflow extends WorkflowBase<object, After<typeof BrokenIndexFlowStep>, boolean> {
  protected finish(state: After<typeof BrokenIndexFlowStep>): boolean {
    return state.opened;
  }
}

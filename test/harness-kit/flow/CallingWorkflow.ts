import { type After, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { CallingStep } from "./CallingStep.ts";
import type { CallInput } from "./types/flow.ts";

@Workflow({ name: "calling", description: "Runs the calling flow step.", steps: [CallingStep] })
export class CallingWorkflow extends WorkflowBase<CallInput, After<typeof CallingStep>, boolean> {
  protected finish(state: After<typeof CallingStep>): boolean {
    return state.called;
  }
}

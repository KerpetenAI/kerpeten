import { type After, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { LockedIndexFlowStep } from "./LockedIndexFlowStep.ts";
import type { GroupedInput } from "./types/flow.ts";

/** Opens its run with the permission group its input names. */
@Workflow({
  name: "grouped-flow",
  description: "Runs the locked flow step in a run of the permission group the input names.",
  steps: [LockedIndexFlowStep],
})
export class GroupedFlowWorkflow extends WorkflowBase<GroupedInput, After<typeof LockedIndexFlowStep>, string> {
  protected override group(input: GroupedInput): string | undefined {
    return input.group;
  }

  protected finish(state: After<typeof LockedIndexFlowStep>): string {
    return state.harness;
  }
}

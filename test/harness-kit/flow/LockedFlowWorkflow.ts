import { type After, type PermissionGrant, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { LockedIndexFlowStep } from "./LockedIndexFlowStep.ts";
import type { GrantedInput } from "./types/flow.ts";

@Workflow({
  name: "locked-flow",
  description: "Runs a flow step that holds a harness whose tool cannot work without the secret.",
  steps: [LockedIndexFlowStep],
})
export class LockedFlowWorkflow extends WorkflowBase<GrantedInput, After<typeof LockedIndexFlowStep>, string> {
  protected override grant(input: GrantedInput): PermissionGrant {
    return { group: "given", every: false, permissions: input.permissions };
  }

  protected finish(state: After<typeof LockedIndexFlowStep>): string {
    return state.harness;
  }
}

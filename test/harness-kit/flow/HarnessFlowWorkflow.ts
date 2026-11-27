import {
  type After,
  type OptionalGap,
  type PermissionGrant,
  Workflow,
  WorkflowBase,
} from "../../../src/harness-kit/index.ts";
import { FlowLog } from "./FlowLog.ts";
import { HarnessIndexFlowStep } from "./HarnessIndexFlowStep.ts";
import type { GrantedInput } from "./types/flow.ts";

@Workflow({
  name: "harness-flow",
  description: "Runs a flow step that holds a harness, in a run with the permissions of the input.",
  steps: [HarnessIndexFlowStep],
})
export class HarnessFlowWorkflow extends WorkflowBase<GrantedInput, After<typeof HarnessIndexFlowStep>, string> {
  protected override grant(input: GrantedInput): PermissionGrant {
    return { group: "given", every: false, permissions: input.permissions };
  }

  protected override admit(_input: GrantedInput, _grant: PermissionGrant, gaps: readonly OptionalGap[]): void {
    for (const gap of gaps) FlowLog.events.push(`gap ${gap.harness} ${gap.tool} ${gap.capability} ${gap.permission}`);
  }

  protected finish(state: After<typeof HarnessIndexFlowStep>): string {
    return state.harness;
  }
}

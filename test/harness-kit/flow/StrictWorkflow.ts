import { type After, type PermissionGrant, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { StrictStep } from "./StrictStep.ts";
import type { StrictInput } from "./types/flow.ts";

/** Refuses the grant of the group `refused` and turns every error into a result that names it. */
@Workflow({
  name: "strict",
  description: "Runs the strict flow step in a run of the input's group.",
  steps: [StrictStep],
})
export class StrictWorkflow extends WorkflowBase<StrictInput, After<typeof StrictStep>, string> {
  protected override grant(input: StrictInput): PermissionGrant {
    return { group: input.group, every: true };
  }

  protected override admit(_input: StrictInput, grant: PermissionGrant): void {
    if (grant.group === "refused") throw new Error(`the group ${grant.group} is refused`);
  }

  protected override rescue(error: unknown, state: StrictInput & Partial<After<typeof StrictStep>>): string {
    return `rescued in group ${state.group}: ${error instanceof Error ? error.message : String(error)}`;
  }

  protected finish(state: After<typeof StrictStep>): string {
    return state.passed ? "passed" : "failed";
  }
}

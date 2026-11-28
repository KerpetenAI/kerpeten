import { type After, ExitCode, Workflow, WorkflowBase } from "@kerpetensh/harness-kit";
import { CapabilityListStep } from "./step/CapabilityListStep.ts";

/** The `capabilities` command: lists what this build can reach and which permissions open it. */
@Workflow({
  name: "capabilities",
  description:
    "List the capabilities of this build, the parts that reach git, the file system and other processes, with what each one does and the permission it needs, then the permission groups a review can be given and the permissions each harness lists.",
  steps: [CapabilityListStep],
  command: { name: "capabilities", usage: "", options: {} },
})
export class CapabilitiesCommand extends WorkflowBase<object, After<typeof CapabilityListStep>, number> {
  public override commandInput(): object {
    return {};
  }

  protected finish(): number {
    return ExitCode.OK;
  }
}

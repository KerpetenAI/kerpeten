import { type After, ExitCode, Workflow, WorkflowBase } from "../../harness-kit/index.ts";
import { SelfCheckStep } from "./step/SelfCheckStep.ts";

/** The `self-check` command: checks this build without the network. */
@Workflow({
  name: "self-check",
  description:
    "Check this build without the network: print the embedded prompt versions and run one scripted model round trip.",
  steps: [SelfCheckStep],
  command: { name: "self-check", usage: "", options: {} },
})
export class SelfCheckCommand extends WorkflowBase<object, After<typeof SelfCheckStep>, number> {
  public override commandInput(): object {
    return {};
  }

  protected finish(): number {
    return ExitCode.OK;
  }
}

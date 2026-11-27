import { type After, ExitCode, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { EchoStep } from "./EchoStep.ts";
import type { EchoInput } from "./types/cli.ts";

@Workflow({
  name: "echo-twin",
  description: "Print the text again.",
  steps: [EchoStep],
  command: { name: "echo", usage: "", options: {} },
})
export class EchoTwinCommand extends WorkflowBase<EchoInput, After<typeof EchoStep>, number> {
  protected finish(): number {
    return ExitCode.OK;
  }
}

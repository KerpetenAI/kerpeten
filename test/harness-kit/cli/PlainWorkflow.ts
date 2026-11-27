import { type After, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import { EchoStep } from "./EchoStep.ts";
import type { EchoInput } from "./types/cli.ts";

@Workflow({ name: "plain", description: "Prints the text, as an internal workflow.", steps: [EchoStep] })
export class PlainWorkflow extends WorkflowBase<EchoInput, After<typeof EchoStep>, number> {
  protected finish(): number {
    return 0;
  }
}

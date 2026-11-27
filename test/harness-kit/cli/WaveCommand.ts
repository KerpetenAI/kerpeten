import { type After, type CommandArgs, ExitCode, Workflow, WorkflowBase } from "../../../src/harness-kit/index.ts";
import type { WaveInput } from "./types/cli.ts";
import { WaveStep } from "./WaveStep.ts";

@Workflow({
  name: "wave",
  description: "Wave hello or goodbye.",
  steps: [WaveStep],
  command: { name: "wave", usage: "hello | bye", options: {}, actions: ["hello", "bye"] },
})
export class WaveCommand extends WorkflowBase<WaveInput, After<typeof WaveStep>, number> {
  public override commandInput(args: CommandArgs): WaveInput {
    return { action: args.action ?? "" };
  }

  protected finish(): number {
    return ExitCode.OK;
  }
}

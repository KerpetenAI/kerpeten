import {
  type After,
  type CommandArgs,
  ExitCode,
  UsageError,
  Workflow,
  WorkflowBase,
} from "../../../src/harness-kit/index.ts";
import { EchoStep } from "./EchoStep.ts";
import type { EchoInput } from "./types/cli.ts";

@Workflow({
  name: "echo",
  description: "Print the text.",
  steps: [EchoStep],
  command: {
    name: "echo",
    usage: "--text <text>",
    options: { text: { type: "string" } },
    oneOf: { flags: ["loud", "quiet"], fallback: "quiet", label: "volume" },
  },
})
export class EchoCommand extends WorkflowBase<EchoInput, After<typeof EchoStep>, number> {
  public override commandInput(args: CommandArgs): EchoInput {
    const text = args.string("text");

    if (text === undefined) throw new UsageError("--text is required");

    return { text: args.choice() === "loud" ? text.toUpperCase() : text };
  }

  protected finish(): number {
    return ExitCode.OK;
  }
}

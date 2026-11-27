import { Inject } from "@asenajs/ioc";
import { ExitCode, FlowStep, FlowStepBase, type KitInstances, KitNames } from "../../../src/harness-kit/index.ts";
import type { EchoInput } from "./types/cli.ts";

@FlowStep({ name: "echo", description: "Prints the text, or fails when the text is fail." })
export class EchoStep extends FlowStepBase {
  @Inject(KitNames.IO)
  private readonly io!: KitInstances[KitNames.IO];

  public execute(state: EchoInput) {
    if (state.text === "fail") return this.end(this.command.fail(ExitCode.FAILED, "asked to fail"));

    this.io.out(state.text);

    return {};
  }
}

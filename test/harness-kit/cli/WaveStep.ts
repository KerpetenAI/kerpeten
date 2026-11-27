import { Inject } from "@asenajs/ioc";
import { FlowStep, FlowStepBase, type KitInstances, KitNames } from "../../../src/harness-kit/index.ts";
import type { WaveInput } from "./types/cli.ts";

@FlowStep({ name: "wave", description: "Prints the action word and the command that runs it." })
export class WaveStep extends FlowStepBase {
  @Inject(KitNames.IO)
  private readonly io!: KitInstances[KitNames.IO];

  public execute(state: WaveInput) {
    this.io.out(`${this.command.program} ${this.command.name} ${state.action}`);

    return {};
  }
}

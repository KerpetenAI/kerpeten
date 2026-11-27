import { Capability, CapabilityBase } from "../../src/harness-kit/index.ts";
import { Builds } from "./Builds.ts";

@Capability({ name: "command-runner", description: "Runs a command.", permission: "commands:run", scope: "run" })
export class CommandRunner extends CapabilityBase {
  public constructor() {
    super();
    Builds.made.push(this.capabilityName);
  }

  public run(command: string): string {
    return `ran ${command}`;
  }
}

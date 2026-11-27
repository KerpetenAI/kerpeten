import { Capability, CapabilityBase } from "../../src/harness-kit/index.ts";
import { Builds } from "./Builds.ts";

@Capability({ name: "reader", description: "Reads a path of the repository.", permission: "repo:read", scope: "run" })
export class Reader extends CapabilityBase {
  public constructor() {
    super();
    Builds.made.push(this.capabilityName);
  }

  public read(path: string): string {
    return `entries of ${path}`;
  }
}

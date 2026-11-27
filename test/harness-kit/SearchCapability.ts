import { Capability, CapabilityBase } from "../../src/harness-kit/index.ts";
import { Builds } from "./Builds.ts";

@Capability({ name: "search", description: "Finds a pattern.", permission: "repo:search", scope: "run" })
export class SearchCapability extends CapabilityBase {
  public constructor() {
    super();
    Builds.made.push(this.capabilityName);
  }

  public search(pattern: string): string[] {
    return [pattern];
  }
}

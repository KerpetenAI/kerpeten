import { Capability, CapabilityBase } from "../../../src/harness-kit/index.ts";

@Capability({ name: "line-reader", description: "Reads a line.", permission: "repo:read", scope: "run" })
export class LineReader extends CapabilityBase {
  public read(path: string): string {
    return `line of ${path}`;
  }
}

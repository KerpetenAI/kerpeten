import { Capability, CapabilityBase } from "../../src/harness-kit/index.ts";
import { Builds } from "./Builds.ts";

@Capability({ name: "file-reader", description: "Reads a file.", permission: "files:read", scope: "run" })
export class FileReader extends CapabilityBase {
  public constructor() {
    super();
    Builds.made.push(this.capabilityName);
  }

  public read(path: string): string {
    return `contents of ${path}`;
  }
}

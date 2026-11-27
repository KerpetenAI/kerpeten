import { Capability } from "../capability/Capability.decorator.ts";
import { CapabilityBase } from "../capability/CapabilityBase.ts";

/** What the self-check probe tool uses, so the round trip also runs a `@Use` field. It counts the tool's calls. */
@Capability({ name: "probe", description: "Counts the calls of the self-check probe tool.", permission: "probe:run" })
export class ProbeCapability extends CapabilityBase {
  private count = 0;

  public get calls(): number {
    return this.count;
  }

  public call(): void {
    this.count++;
  }
}

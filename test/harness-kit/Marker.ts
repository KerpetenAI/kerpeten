import { Capability, CapabilityBase } from "../../src/harness-kit/index.ts";

@Capability({ name: "marker", description: "Tells one run from another.", permission: "marker:read" })
export class Marker extends CapabilityBase {
  public readonly id: number;

  public constructor(id: number) {
    super();
    this.id = id;
  }
}

import { capabilitySpec } from "./Capability.decorator.ts";

export abstract class CapabilityBase {
  public readonly capabilityName: string;

  public constructor() {
    this.capabilityName = capabilitySpec(new.target).name;
  }
}

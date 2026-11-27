import { Capability, CapabilityBase } from "../../src/harness-kit/index.ts";

@Capability({ name: "local", description: "Used only by the program itself." })
export class LocalCapability extends CapabilityBase {}

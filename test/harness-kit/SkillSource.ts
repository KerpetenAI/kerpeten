import { Capability, CapabilityBase } from "../../src/harness-kit/index.ts";

@Capability({ name: "skills", description: "Where the skills come from.", permission: "skills:read" })
export abstract class SkillSource extends CapabilityBase {
  public abstract list(): readonly string[];
}

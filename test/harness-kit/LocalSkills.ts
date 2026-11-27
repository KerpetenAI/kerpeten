import { Capability } from "../../src/harness-kit/index.ts";
import { SkillSource } from "./SkillSource.ts";

@Capability({ name: "local-skills", description: "Skills from a local source.", permission: "skills:read" })
export class LocalSkills extends SkillSource {
  public list(): readonly string[] {
    return ["local"];
  }
}

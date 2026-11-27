import { Capability } from "../../src/harness-kit/index.ts";
import { SkillSource } from "./SkillSource.ts";

@Capability({ name: "remote-skills", description: "Skills from a remote source.", permission: "skills:read" })
export class RemoteSkills extends SkillSource {
  public list(): readonly string[] {
    return ["remote"];
  }
}

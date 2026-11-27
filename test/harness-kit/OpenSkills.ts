import { SkillSource } from "./SkillSource.ts";

export class OpenSkills extends SkillSource {
  public list(): readonly string[] {
    return ["open"];
  }
}

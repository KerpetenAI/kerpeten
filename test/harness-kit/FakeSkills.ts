import { SkillSource } from "./SkillSource.ts";

export class FakeSkills extends SkillSource {
  public list(): readonly string[] {
    return ["fake"];
  }
}

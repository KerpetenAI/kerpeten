import { Tool, Use } from "../../src/harness-kit/index.ts";
import { SkillSource } from "./SkillSource.ts";
import { emptyInput } from "./schemas/fake-schema.ts";

@Tool({ name: "skills", description: "Lists the skills.", input: emptyInput })
export class SkillTool {
  @Use(SkillSource)
  private readonly skills!: SkillSource;

  public execute(): unknown {
    return this.skills.list();
  }
}

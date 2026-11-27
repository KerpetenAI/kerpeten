import { Service } from "@asenajs/ioc";
import judgeV1 from "../../prompts/judge/v1.md" with { type: "text" };
import judgeV2 from "../../prompts/judge/v2.md" with { type: "text" };
import judgeV3 from "../../prompts/judge/v3.md" with { type: "text" };
import reviewerV1 from "../../prompts/reviewer/v1.md" with { type: "text" };
import reviewerV2 from "../../prompts/reviewer/v2.md" with { type: "text" };
import reviewerV3 from "../../prompts/reviewer/v3.md" with { type: "text" };
import type { PromptRole, PromptVariables } from "./types/harnesses.ts";

@Service("kerpeten:prompts")
export class Prompts {
  private static readonly PLACEHOLDER = /\{\{([a-z_]+)\}\}/g;

  public readonly roles: readonly PromptRole[] = ["reviewer", "judge"];

  public readonly embedded: Readonly<Record<PromptRole, Readonly<Record<string, string>>>> = {
    reviewer: { v1: reviewerV1, v2: reviewerV2, v3: reviewerV3 },
    judge: { v1: judgeV1, v2: judgeV2, v3: judgeV3 },
  };

  public readonly current: Readonly<Record<PromptRole, string>> = {
    reviewer: "v3",
    judge: "v3",
  };

  public template(role: PromptRole, version: string): string {
    const versions = this.embedded[role];

    if (!Object.hasOwn(versions, version)) throw new Error(`no ${role} prompt ${version}`);

    return versions[version] as string;
  }

  public fill(template: string, variables: PromptVariables): string {
    return template.replace(Prompts.PLACEHOLDER, (_match, name: string) => {
      if (!Object.hasOwn(variables, name)) throw new Error(`the prompt uses an unknown variable ${name}`);

      return variables[name as keyof PromptVariables];
    });
  }

  public render(role: PromptRole, version: string, variables: PromptVariables): string {
    return this.fill(this.template(role, version), variables);
  }
}

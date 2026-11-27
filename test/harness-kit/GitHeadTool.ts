import { z } from "zod";
import { Tool, Use } from "../../src/harness-kit/index.ts";
import { LocalCapability } from "./LocalCapability.ts";

@Tool({ name: "git_head", description: "Reads HEAD.", input: z.strictObject({}) })
export class GitHeadTool {
  @Use(LocalCapability)
  private readonly local!: LocalCapability;

  public execute(): unknown {
    return { name: this.local.capabilityName };
  }
}

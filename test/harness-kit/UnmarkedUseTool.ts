import { z } from "zod";
import { Tool, Use } from "../../src/harness-kit/index.ts";
import { Unmarked } from "./Unmarked.ts";

@Tool({ name: "unmarked_use", description: "Uses a class that is no capability.", input: z.strictObject({}) })
export class UnmarkedUseTool {
  @Use(Unmarked)
  private readonly thing!: Unmarked;

  public execute(): unknown {
    return { name: this.thing.capabilityName };
  }
}

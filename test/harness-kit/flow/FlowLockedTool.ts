import type { z } from "zod";
import { Tool, Use } from "../../../src/harness-kit/index.ts";
import { listInput } from "../schemas/fake-schema.ts";
import { FlowSecret } from "./FlowSecret.ts";

@Tool({ name: "flow_locked", description: "Reads the secret and cannot work without it.", input: listInput })
export class FlowLockedTool {
  @Use(FlowSecret)
  private readonly secret!: FlowSecret;

  public execute(input: z.infer<typeof listInput>): unknown {
    return this.secret.read(input.path);
  }
}

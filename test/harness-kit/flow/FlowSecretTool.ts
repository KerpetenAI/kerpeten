import type { z } from "zod";
import { Tool, Use } from "../../../src/harness-kit/index.ts";
import { listInput } from "../schemas/fake-schema.ts";
import { FlowSecret } from "./FlowSecret.ts";

@Tool({ name: "flow_secret", description: "Reads the secret when the run gives it.", input: listInput })
export class FlowSecretTool {
  @Use(FlowSecret, { required: false })
  private readonly secret: FlowSecret | undefined;

  public execute(input: z.infer<typeof listInput>): unknown {
    return this.secret?.read(input.path);
  }
}

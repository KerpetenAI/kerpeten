import type { z } from "zod";
import { Harness, HarnessBase } from "../../../src/harness-kit/index.ts";
import { testOutput } from "../schemas/fake-schema.ts";
import { FlowSecretTool } from "./FlowSecretTool.ts";

@Harness({ name: "flow-secret", tools: [FlowSecretTool], permissions: ["flow:secret"] })
export class FlowSecretHarness extends HarnessBase<string, z.infer<typeof testOutput>> {
  protected readonly output = testOutput;
  protected readonly finalizeRequest = "report now";

  protected instructions(): string {
    return "read the secret";
  }

  protected context(): string {
    return "a secret";
  }
}

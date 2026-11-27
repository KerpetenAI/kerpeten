import type { z } from "zod";
import { Harness, HarnessBase } from "../../../src/harness-kit/index.ts";
import { testOutput } from "../schemas/fake-schema.ts";
import { FlowLockedTool } from "./FlowLockedTool.ts";

@Harness({ name: "flow-locked", tools: [FlowLockedTool], permissions: ["flow:secret"] })
export class FlowLockedHarness extends HarnessBase<string, z.infer<typeof testOutput>> {
  protected readonly output = testOutput;
  protected readonly finalizeRequest = "report now";

  protected instructions(): string {
    return "read the secret";
  }

  protected context(): string {
    return "a secret";
  }
}

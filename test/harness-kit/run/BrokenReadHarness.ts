import type { z } from "zod";
import { Harness, HarnessBase } from "../../../src/harness-kit/index.ts";
import { testOutput } from "../schemas/fake-schema.ts";
import { BrokenReadTool } from "./BrokenReadTool.ts";

@Harness({ name: "broken-read", tools: [BrokenReadTool], permissions: ["repo:read"] })
export class BrokenReadHarness extends HarnessBase<string, z.infer<typeof testOutput>> {
  protected readonly output = testOutput;
  protected readonly finalizeRequest = "report now";

  protected instructions(): string {
    return "read the source";
  }

  protected context(): string {
    return "a source";
  }
}

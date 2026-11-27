import type { z } from "zod";
import { Harness, HarnessBase } from "../../src/harness-kit/index.ts";
import { FakeReadFileTool } from "./FakeReadFileTool.ts";
import { testOutput } from "./schemas/fake-schema.ts";

@Harness({ name: "test", tools: [FakeReadFileTool], permissions: [] })
export class TestHarness extends HarnessBase<string, z.infer<typeof testOutput>> {
  protected readonly output = testOutput;
  protected readonly finalizeRequest = "report now";

  protected instructions(): string {
    return "find bugs";
  }

  protected context(): string {
    return "diff";
  }
}

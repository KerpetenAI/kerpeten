import type { z } from "zod";
import { Harness } from "../Harness.decorator.ts";
import { HarnessBase } from "../HarnessBase.ts";
import { ProbeTool } from "./ProbeTool.ts";
import { probeOutput } from "./schemas/probe-schema.ts";

@Harness({ name: "self-check", tools: [ProbeTool], permissions: ["probe:run"] })
export class ProbeHarness extends HarnessBase<undefined, z.infer<typeof probeOutput>> {
  protected readonly output = probeOutput;
  protected readonly finalizeRequest = "report";

  protected instructions(): string {
    return "self-check";
  }

  protected context(): string {
    return "self-check";
  }
}

import type { z } from "zod";
import { Use } from "../capability/Use.decorator.ts";
import { Tool } from "../Tool.decorator.ts";
import { ProbeCapability } from "./ProbeCapability.ts";
import { probeInput } from "./schemas/probe-schema.ts";

@Tool({ name: "probe", description: "probe", input: probeInput })
export class ProbeTool {
  @Use(ProbeCapability)
  private readonly probe!: ProbeCapability;

  public execute(_input: z.infer<typeof probeInput>): unknown {
    this.probe.call();

    return { ok: true };
  }
}

import { Inject } from "@asenajs/ioc";
import { FlowStep, FlowStepBase } from "../../../src/harness-kit/index.ts";
import { FlowLockedHarness } from "./FlowLockedHarness.ts";
import { FlowLog } from "./FlowLog.ts";
import type { GrantedInput } from "./types/flow.ts";

@FlowStep({ name: "locked-flow", description: "Holds the flow locked harness." })
export class LockedIndexFlowStep extends FlowStepBase {
  @Inject(FlowLockedHarness)
  private readonly harness!: FlowLockedHarness;

  public execute(_state: GrantedInput) {
    FlowLog.events.push("flow step locked");

    return { harness: this.harness.spec.name };
  }
}

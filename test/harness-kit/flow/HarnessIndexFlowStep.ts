import { Inject } from "@asenajs/ioc";
import { FlowStep, FlowStepBase } from "../../../src/harness-kit/index.ts";
import { FlowSecretHarness } from "./FlowSecretHarness.ts";
import type { GrantedInput } from "./types/flow.ts";

@FlowStep({ name: "harness-flow", description: "Holds the flow secret harness." })
export class HarnessIndexFlowStep extends FlowStepBase {
  @Inject(FlowSecretHarness)
  private readonly harness!: FlowSecretHarness;

  public execute(_state: GrantedInput) {
    return { harness: this.harness.spec.name };
  }
}

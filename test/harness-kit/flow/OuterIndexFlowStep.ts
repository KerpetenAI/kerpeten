import { FlowStep, FlowStepBase, Use } from "../../../src/harness-kit/index.ts";
import { FlowLog } from "./FlowLog.ts";
import { FlowSource } from "./FlowSource.ts";
import type { FlowInput } from "./types/flow.ts";

@FlowStep({ name: "outer-flow", description: "Takes the flow source." })
export class OuterIndexFlowStep extends FlowStepBase {
  @Use(FlowSource)
  private readonly source!: FlowSource;

  public execute(_state: FlowInput) {
    FlowLog.events.push("flow step outer");

    return { outer: this.source instanceof FlowSource };
  }
}

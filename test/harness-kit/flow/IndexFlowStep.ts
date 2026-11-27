import { FlowStep, FlowStepBase, Use } from "../../../src/harness-kit/index.ts";
import { FlowIndex } from "./FlowIndex.ts";
import { FlowLog } from "./FlowLog.ts";
import type { FlowInput } from "./types/flow.ts";

@FlowStep({ name: "flow", description: "Takes the flow index." })
export class IndexFlowStep extends FlowStepBase {
  @Use(FlowIndex)
  private readonly index!: FlowIndex;

  public execute(_state: FlowInput) {
    FlowLog.events.push("flow step flow");

    return { indexed: this.index instanceof FlowIndex };
  }
}

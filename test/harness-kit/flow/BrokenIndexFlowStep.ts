import { FlowStep, FlowStepBase, Use } from "../../../src/harness-kit/index.ts";
import { BrokenFlowSource } from "./BrokenFlowSource.ts";
import { FlowLog } from "./FlowLog.ts";

@FlowStep({ name: "broken-flow", description: "Takes the broken flow source." })
export class BrokenIndexFlowStep extends FlowStepBase {
  @Use(BrokenFlowSource)
  private readonly source!: BrokenFlowSource;

  public execute(_state: object) {
    FlowLog.events.push("flow step broken");

    return { opened: this.source instanceof BrokenFlowSource };
  }
}

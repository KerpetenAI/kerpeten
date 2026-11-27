import { OnFlowStart, RunService, Use } from "../../../src/harness-kit/index.ts";
import { FlowLog } from "./FlowLog.ts";
import { FlowSource } from "./FlowSource.ts";

/** A run service over the flow source, with hooks of both types. */
@RunService("test:flow-index")
export class FlowIndex {
  @Use(FlowSource)
  private readonly source!: FlowSource;

  @OnFlowStart({ type: "run" })
  public index(): void {
    FlowLog.events.push(`run index over ${this.source.label}`);
  }

  @OnFlowStart({ type: "workflow" })
  public touch(): void {
    FlowLog.events.push("workflow index");
  }
}

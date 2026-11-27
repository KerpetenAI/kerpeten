import { Capability, CapabilityBase, OnFlowStart, RunValue } from "../../../src/harness-kit/index.ts";
import { FlowLog } from "./FlowLog.ts";

/** A run capability with a `"run"` hook that reads the run value `label` and a `"workflow"` hook. */
@Capability({ name: "flow-source", description: "A source opened once per run.", scope: "run" })
export class FlowSource extends CapabilityBase {
  @RunValue("label")
  public readonly label!: string;

  @OnFlowStart({ type: "run" })
  public async open(): Promise<void> {
    await Bun.sleep(2);

    FlowLog.events.push(`run source ${this.label}`);
  }

  @OnFlowStart({ type: "workflow" })
  public touch(): void {
    FlowLog.events.push("workflow source");
  }
}

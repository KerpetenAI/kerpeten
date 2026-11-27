import { Capability, CapabilityBase, OnFlowStart } from "../../../src/harness-kit/index.ts";
import { FlowLog } from "./FlowLog.ts";

@Capability({
  name: "flow-secret",
  description: "A secret a tool reads.",
  permission: "flow:secret",
  scope: "run",
})
export class FlowSecret extends CapabilityBase {
  @OnFlowStart({ type: "run" })
  public open(): void {
    FlowLog.events.push("run secret");
  }

  public read(path: string): string {
    return `secret ${path}`;
  }
}

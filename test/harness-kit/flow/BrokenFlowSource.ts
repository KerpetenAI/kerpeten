import { Capability, CapabilityBase, OnFlowStart } from "../../../src/harness-kit/index.ts";

/** A run capability whose `"run"` hook always throws `FAILURE`; it counts the hook calls. */
@Capability({ name: "broken-flow-source", description: "A source that cannot be opened.", scope: "run" })
export class BrokenFlowSource extends CapabilityBase {
  public static readonly FAILURE = new Error("the broken flow source cannot be opened");

  public static opened = 0;

  @OnFlowStart({ type: "run" })
  public open(): void {
    BrokenFlowSource.opened++;

    throw BrokenFlowSource.FAILURE;
  }
}

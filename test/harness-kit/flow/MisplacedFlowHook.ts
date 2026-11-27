import { Capability, CapabilityBase, OnFlowStart } from "../../../src/harness-kit/index.ts";

/** A capability built once for the program, so no run component, that marks a method with `@OnFlowStart`. */
@Capability({ name: "misplaced-flow", description: "A singleton with a flow start hook." })
export class MisplacedFlowHook extends CapabilityBase {
  @OnFlowStart({ type: "run" })
  public open(): void {}
}

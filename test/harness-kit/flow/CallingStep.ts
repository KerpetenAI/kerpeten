import { Inject } from "@asenajs/ioc";
import { FlowStep, FlowStepBase } from "../../../src/harness-kit/index.ts";
import { FlowLog } from "./FlowLog.ts";
import { FlowWorkflow } from "./FlowWorkflow.ts";
import type { CallInput } from "./types/flow.ts";

@FlowStep({ name: "calling", description: "Runs the flow workflow with the label `inner`." })
export class CallingStep extends FlowStepBase {
  @Inject(FlowWorkflow)
  private readonly flow!: FlowWorkflow;

  public async execute(state: CallInput) {
    FlowLog.events.push("flow step calling");

    const { indexed } = await this.flow.run({ label: state.inner });

    return { called: indexed };
  }
}

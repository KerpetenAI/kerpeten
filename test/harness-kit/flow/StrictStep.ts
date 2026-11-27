import { FlowStep, FlowStepBase } from "../../../src/harness-kit/index.ts";
import type { StrictInput } from "./types/flow.ts";

@FlowStep({ name: "strict", description: "Passes, or throws when the input asks it to crash." })
export class StrictStep extends FlowStepBase {
  public execute(state: StrictInput) {
    if (state.crash === true) throw new Error("the strict flow step crashed");

    return { passed: true };
  }
}

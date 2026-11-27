import { FlowStep, FlowStepBase } from "../../../src/harness-kit/index.ts";
import type { RunInput } from "./types/run.ts";

@FlowStep({ name: "grant", description: "Reads the permission group of its run." })
export class GrantStep extends FlowStepBase {
  public execute(_state: RunInput) {
    return { group: this.run.grant.group };
  }
}

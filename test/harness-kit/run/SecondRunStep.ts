import { FlowStep, FlowStepBase, Use } from "../../../src/harness-kit/index.ts";
import { CountedService } from "./CountedService.ts";
import type { RunInput } from "./types/run.ts";

@FlowStep({ name: "second-run", description: "Reads the counted service of the run again." })
export class SecondRunStep extends FlowStepBase {
  @Use(CountedService)
  private readonly counted!: CountedService;

  public execute(_state: RunInput) {
    return { second: this.counted.id };
  }
}

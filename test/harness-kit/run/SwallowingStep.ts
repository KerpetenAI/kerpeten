import { Inject } from "@asenajs/ioc";
import type { LlmAdapter } from "../../../src/harness-kit/index.ts";
import { FlowStep, FlowStepBase } from "../../../src/harness-kit/index.ts";
import { limits, log } from "../harness-kit-utils.ts";
import { BrokenReadHarness } from "./BrokenReadHarness.ts";
import type { BrokenRunInput } from "./types/run.ts";

/** Runs the broken-read harness once per model, all at the same time, and keeps every error instead of throwing it. */
@FlowStep({
  name: "swallowing",
  description: "Runs the broken-read harness in parallel and keeps every error it throws.",
})
export class SwallowingStep extends FlowStepBase {
  public static readonly caught: unknown[] = [];

  @Inject(BrokenReadHarness)
  private readonly harness!: BrokenReadHarness;

  public async execute(state: BrokenRunInput) {
    const ended = await Promise.all(state.llms.map((llm) => this.attempt(llm)));

    return { ended: ended.length };
  }

  private async attempt(llm: LlmAdapter): Promise<void> {
    try {
      await this.harness.run("request", { llm, limits: limits(), now: () => 0, log });
    } catch (error) {
      SwallowingStep.caught.push(error);
    }
  }
}

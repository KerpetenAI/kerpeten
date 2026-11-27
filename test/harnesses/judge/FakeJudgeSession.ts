import type { z } from "zod";
import type {
  CallUsage,
  FinalizeOutcome,
  LlmSession,
  ToolPhaseHooks,
  ToolPhaseOutcome,
} from "../../../src/harness-kit/index.ts";
import type { FakeJudgeAnswer } from "../types/harnesses.ts";
import type { FakeJudgeLlm } from "./FakeJudgeLlm.ts";

export class FakeJudgeSession implements LlmSession {
  public static readonly FINAL_INPUT_TOKENS = 50;

  private readonly llm: FakeJudgeLlm;
  private readonly answer: FakeJudgeAnswer;

  public constructor(llm: FakeJudgeLlm, answer: FakeJudgeAnswer) {
    this.llm = llm;
    this.answer = answer;
  }

  public async runTools(hooks: ToolPhaseHooks): Promise<ToolPhaseOutcome> {
    const { name } = this.answer;

    this.llm.enter(name);

    try {
      if (this.answer.delayMs !== undefined) await Bun.sleep(this.answer.delayMs);

      this.answer.onRun?.();

      if (this.answer.throws === true) throw new Error(`session of ${name} broke`);

      for (let call = 0; call < (this.answer.toolCalls ?? 0); call++) {
        const result = await hooks.runTool({ id: `${name}-${call}`, name: "list_dir", input: { path: "." } });

        this.llm.toolOutputs.push(result.output);
      }

      let steps = 0;

      while (steps < (this.answer.steps ?? 1)) {
        steps++;
        hooks.onUsage(FakeJudgeSession.usage(this.answer.inputTokens ?? 100));

        if (hooks.shouldStop()) break;
      }

      if (this.answer.throwsAfterUsage === true) throw new Error(`session of ${name} broke after a model call`);

      return { ok: true, steps };
    } finally {
      this.llm.leave(name);
    }
  }

  public async finalize<T>(_request: string, output: z.ZodType<T>): Promise<FinalizeOutcome<T>> {
    const usage = [FakeJudgeSession.usage(FakeJudgeSession.FINAL_INPUT_TOKENS)];

    if (this.answer.labels === undefined) {
      return { ok: false, kind: "model_error", error: this.answer.error ?? "no answer", usage };
    }

    return { ok: true, value: output.parse(this.answer.labels), usage };
  }

  private static usage(inputTokens: number): CallUsage {
    return { inputTokens, outputTokens: 10, cacheReadTokens: undefined, cacheWriteTokens: undefined };
  }
}

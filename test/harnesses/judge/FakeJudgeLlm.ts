import type { LlmSession, SessionInput } from "@kerpetensh/harness-kit";
import type { ProviderLlm } from "../../../src/harnesses/types/harnesses.ts";
import type { FakeJudgeAnswer } from "../types/harnesses.ts";
import { FakeJudgeSession } from "./FakeJudgeSession.ts";

export class FakeJudgeLlm implements ProviderLlm {
  public readonly provider: ProviderLlm["provider"];
  public readonly model: string;
  public readonly events: string[] = [];
  public readonly contexts: string[] = [];
  public readonly toolOutputs: unknown[] = [];
  public maxRunning = 0;
  private readonly answer: (context: string) => FakeJudgeAnswer;
  private running = 0;

  public constructor(
    answer: (context: string) => FakeJudgeAnswer,
    provider: ProviderLlm["provider"] = "openai",
    model = "judge-model",
  ) {
    this.answer = answer;
    this.provider = provider;
    this.model = model;
  }

  public static titleOf(context: string): string {
    return /^title: (.*)$/m.exec(context)?.[1] ?? "";
  }

  public start(input: SessionInput): LlmSession {
    this.contexts.push(input.context);

    return new FakeJudgeSession(this, this.answer(input.context));
  }

  public enter(name: string): void {
    this.events.push(`start ${name}`);
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
  }

  public leave(name: string): void {
    this.events.push(`end ${name}`);
    this.running--;
  }
}

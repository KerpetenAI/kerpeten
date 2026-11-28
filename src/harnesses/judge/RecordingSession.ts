import {
  type CallUsage,
  type FinalizeOutcome,
  type LlmFailureKind,
  type LlmSession,
  type ToolPhaseHooks,
  type ToolPhaseOutcome,
  UsageTally,
} from "@kerpetensh/harness-kit";
import type { z } from "zod";

/**
 * Wraps a model session and records what it did: the usage of every model call and the tool calls the model asked
 * for. A token count that is not a finite number of at least 0 is recorded as unknown.
 */
export class RecordingSession implements LlmSession {
  private readonly inner: LlmSession;

  private readonly tally = new UsageTally();

  private failure: LlmFailureKind | undefined;

  private requestedToolCalls = 0;

  public constructor(inner: LlmSession) {
    this.inner = inner;
  }

  public get finalFailure(): LlmFailureKind | undefined {
    return this.failure;
  }

  public get usage(): UsageTally {
    return this.tally;
  }

  /** The tool calls the model asked for, run or refused, with no tool limit applied. */
  public get toolCalls(): number {
    return this.requestedToolCalls;
  }

  public runTools(hooks: ToolPhaseHooks, signal: AbortSignal): Promise<ToolPhaseOutcome> {
    return this.inner.runTools(
      {
        ...hooks,
        runTool: (call) => {
          this.requestedToolCalls++;

          return hooks.runTool(call);
        },
        onRefusedCall: (call, error) => {
          this.requestedToolCalls++;

          hooks.onRefusedCall(call, error);
        },
        onUsage: (usage) => {
          this.record([usage]);

          hooks.onUsage(usage);
        },
      },
      signal,
    );
  }

  public async finalize<T>(request: string, output: z.ZodType<T>, signal: AbortSignal): Promise<FinalizeOutcome<T>> {
    const outcome = await this.inner.finalize(request, output, signal);

    this.record(outcome.usage);

    this.failure = outcome.ok ? undefined : outcome.kind;

    return outcome;
  }

  private record(calls: readonly CallUsage[]): void {
    this.tally.add(
      calls.map((call) => ({
        inputTokens: RecordingSession.known(call.inputTokens),
        outputTokens: RecordingSession.known(call.outputTokens),
        cacheReadTokens: RecordingSession.known(call.cacheReadTokens),
        cacheWriteTokens: RecordingSession.known(call.cacheWriteTokens),
      })),
    );
  }

  private static known(count: number | undefined): number | undefined {
    return count !== undefined && Number.isFinite(count) && count >= 0 ? count : undefined;
  }
}

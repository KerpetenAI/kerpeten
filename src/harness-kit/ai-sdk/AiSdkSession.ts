import {
  generateText,
  type JSONValue,
  type LanguageModelUsage,
  type ModelMessage,
  NoObjectGeneratedError,
  Output,
  type StepResult,
  type SystemModelMessage,
  ToolChoiceViolationError,
  type ToolContent,
  ToolLoopAgent,
  type ToolResultPart,
  type ToolSet,
  tool,
} from "ai";
import type { z } from "zod";
import { errorText } from "../harness-kit-utils.ts";
import type {
  CallUsage,
  FinalizeOutcome,
  LlmSession,
  LlmToolCall,
  LlmToolResult,
  SessionInput,
  ToolPhaseHooks,
  ToolPhaseOutcome,
} from "../types/llm.ts";
import type { CacheOptions, SessionOptions, ToolExecuteOptions, ToolOutputOptions } from "./types/ai-sdk.ts";
import type { CacheMarker } from "./types/provider.ts";

export class AiSdkSession implements LlmSession {
  private static readonly FINALIZE_ATTEMPTS = 2;

  private static readonly CUT_OFF_TOOL_CALL = "not run: the answer was cut off";

  private static readonly UNKNOWN_USAGE: CallUsage = {
    inputTokens: undefined,
    outputTokens: undefined,
    cacheReadTokens: undefined,
    cacheWriteTokens: undefined,
  };

  private readonly options: SessionOptions;
  private readonly input: SessionInput;
  private readonly system: SystemModelMessage;
  private messages: ModelMessage[];

  public constructor(options: SessionOptions, input: SessionInput) {
    this.options = options;
    this.input = input;
    this.system = { role: "system", content: input.instructions, ...AiSdkSession.marker(options.cache) };
    this.messages = [{ role: "user", content: input.context, ...AiSdkSession.marker(options.cache) }];
  }

  private static marker(cache: CacheMarker | undefined): CacheOptions {
    return cache === undefined ? {} : { providerOptions: cache };
  }

  private static usageOf(usage: LanguageModelUsage | undefined): CallUsage {
    return {
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens,
      cacheWriteTokens: usage?.inputTokenDetails?.cacheWriteTokens,
    };
  }

  private static message(error: unknown): string {
    return errorText(error, 500);
  }

  private static modelOutput(result: LlmToolResult): ToolResultPart["output"] {
    return result.isError
      ? {
          type: "error-text",
          value: typeof result.output === "string" ? result.output : JSON.stringify(result.output),
        }
      : { type: "json", value: (result.output ?? null) as JSONValue };
  }

  private static toolSet(input: SessionInput, hooks?: ToolPhaseHooks): ToolSet {
    const tools: ToolSet = {};

    for (const spec of input.tools) {
      tools[spec.name] =
        hooks === undefined
          ? tool({ description: spec.description, inputSchema: spec.input })
          : tool({
              description: spec.description,
              inputSchema: spec.input,
              execute: (input: unknown, { toolCallId }: ToolExecuteOptions) =>
                hooks.runTool({ id: toolCallId, name: spec.name, input }),
              toModelOutput: ({ output }: ToolOutputOptions) => AiSdkSession.modelOutput(output),
            });
    }

    return tools;
  }

  private static withAnswers(
    messages: readonly ModelMessage[],
    answers: ToolContent,
    order: readonly string[],
  ): ModelMessage[] {
    const last = messages.at(-1);

    if (last?.role !== "tool") return [...messages, { role: "tool", content: answers }];

    const position = (part: ToolContent[number]) => ("toolCallId" in part ? order.indexOf(part.toolCallId) : -1);
    const content = [...last.content, ...answers].sort((a, b) => position(a) - position(b));

    return [...messages.slice(0, -1), { ...last, content }];
  }

  private static withMarkedLast(messages: readonly ModelMessage[], cache: CacheMarker | undefined): ModelMessage[] {
    const copy = [...messages];
    const last = copy.at(-1);

    if (cache === undefined || last === undefined || copy.length < 2) return copy;

    copy[copy.length - 1] = { ...last, ...AiSdkSession.marker(cache) } as ModelMessage;

    return copy;
  }

  private common() {
    return {
      model: this.options.model,
      maxOutputTokens: this.options.maxOutputTokens,
      maxRetries: this.options.maxRetries,
      ...(this.options.effort === undefined ? {} : { providerOptions: this.options.effort }),
    };
  }

  public async runTools(hooks: ToolPhaseHooks, signal: AbortSignal): Promise<ToolPhaseOutcome> {
    let steps = 0;

    const agent = new ToolLoopAgent({
      ...this.common(),
      instructions: this.system,
      tools: AiSdkSession.toolSet(this.input, hooks),
      toolChoice: "auto",
      toolCallConcurrency: 1,
      stopWhen: () => hooks.shouldStop(),
      prepareStep: ({ initialMessages, responseMessages }) => ({
        messages: AiSdkSession.withMarkedLast([...initialMessages, ...responseMessages], this.options.cache),
      }),
      onStepStart: () => {
        steps++;
      },
      onStepEnd: (step) => this.endStep(step, hooks),
      onStepError: () => hooks.onUsage(AiSdkSession.UNKNOWN_USAGE),
    });

    try {
      await agent.generate({ messages: [...this.messages], abortSignal: signal });

      return { ok: true, steps };
    } catch (error) {
      return { ok: false, kind: signal.aborted ? "aborted" : "model_error", error: AiSdkSession.message(error), steps };
    }
  }

  private endStep(step: StepResult<ToolSet>, hooks: ToolPhaseHooks): void {
    hooks.onUsage(AiSdkSession.usageOf(step.usage));

    const answered = new Set(
      step.content.flatMap((part) =>
        part.type === "tool-result" || part.type === "tool-error" ? [part.toolCallId] : [],
      ),
    );

    const cutOff: ToolContent = [];

    for (const call of step.toolCalls) {
      const entry: LlmToolCall = { id: call.toolCallId, name: call.toolName, input: call.input };

      if (call.invalid === true) {
        hooks.onRefusedCall(entry, AiSdkSession.message(call.error));
      } else if (!answered.has(call.toolCallId)) {
        hooks.onCutOffCall(entry);

        cutOff.push({
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: { type: "error-text", value: AiSdkSession.CUT_OFF_TOOL_CALL },
        });
      }
    }

    this.messages.push(...step.response.messages);

    if (cutOff.length === 0) return;

    const order = step.toolCalls.map((call) => call.toolCallId);

    this.messages = AiSdkSession.withAnswers(this.messages, cutOff, order);
  }

  public async finalize<T>(request: string, output: z.ZodType<T>, signal: AbortSignal): Promise<FinalizeOutcome<T>> {
    const finalMessages: ModelMessage[] = [...this.messages, { role: "user", content: request }];
    const usage: CallUsage[] = [];
    let last = "";

    for (let attempt = 0; attempt < AiSdkSession.FINALIZE_ATTEMPTS; attempt++) {
      let callUsage: LanguageModelUsage | undefined;

      try {
        const result = await generateText({
          ...this.common(),
          system: this.system,
          tools: AiSdkSession.toolSet(this.input),
          messages: AiSdkSession.withMarkedLast(finalMessages, this.options.cache),
          toolChoice: "none",
          output: Output.object({ schema: output }),
          abortSignal: signal,
          onLanguageModelCallEnd: (event) => {
            callUsage = event.usage;
          },
        });

        usage.push(AiSdkSession.usageOf(result.usage));

        return { ok: true, value: result.output, usage };
      } catch (error) {
        if (signal.aborted) {
          usage.push(AiSdkSession.UNKNOWN_USAGE);

          return { ok: false, kind: "aborted", error: AiSdkSession.message(error), usage };
        }

        if (ToolChoiceViolationError.isInstance(error)) {
          usage.push(callUsage === undefined ? AiSdkSession.UNKNOWN_USAGE : AiSdkSession.usageOf(callUsage));
          last = AiSdkSession.message(error);
          continue;
        }

        if (!NoObjectGeneratedError.isInstance(error)) {
          usage.push(AiSdkSession.UNKNOWN_USAGE);

          return { ok: false, kind: "model_error", error: AiSdkSession.message(error), usage };
        }

        usage.push(AiSdkSession.usageOf(error.usage));
        last = AiSdkSession.message(error);
      }
    }

    return { ok: false, kind: "invalid_output", error: last, usage };
  }
}

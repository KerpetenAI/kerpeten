import type { z } from "zod";
import { Budget } from "./Budget.ts";
import { harnessSpec } from "./Harness.decorator.ts";
import { briefInput } from "./harness-kit-utils.ts";
import type { Run } from "./run/Run.ts";
import { RunScope } from "./run/RunScope.ts";
import type { RunFailure } from "./run/types/run.ts";
import { toolSpec } from "./Tool.decorator.ts";
import { Toolbox } from "./Toolbox.ts";
import type { HarnessOptions, HarnessRun, HarnessSpec, PartialReason } from "./types/harness.ts";
import type { ToolPhaseOutcome } from "./types/llm.ts";
import type { BoundTool, ToolOutcome } from "./types/tool.ts";
import { UsageTally } from "./UsageTally.ts";

/**
 * Runs a model with the harness's tools on one request. A harness keeps no state of a run: everything a run needs comes
 * in its options or from the open run, so one harness object serves runs at the same time. Its tools run in the run
 * the options name, or else in the run that is open. Its tools are given once with `bind`; a harness that is never
 * bound builds its own the first time it runs.
 *
 * A harness runs in a flow step of a workflow: the workflow checked the run's grant against the harness when it started. In
 * a run no workflow started, `run` throws before the model is called, unless the run was opened with `test: true`.
 *
 * A run that cannot make ready what a tool takes ends the harness run: `run` throws the build's error as it is, the
 * model is not called again and gives no final answer. Harness runs that share that run end the same way, at their next
 * tool call or step, and one that starts in a failed run throws at once.
 */
export abstract class HarnessBase<
  Request = unknown,
  Output = unknown,
  Options extends HarnessOptions = HarnessOptions,
> {
  private static readonly LOGGED_INPUT_CHARS = 200;

  private static readonly SKIPPED_TOOL_CALL: Readonly<Record<PartialReason, string>> = {
    tool_call_budget: "not run: the tool call budget is used up; give your final answer now",
    time_budget: "not run: the time budget is used up; give your final answer now",
    model_error: "not run: the run is ending; give your final answer now",
  };

  public readonly spec: HarnessSpec;
  protected readonly skippedToolCall: Readonly<Record<PartialReason, string>> = HarnessBase.SKIPPED_TOOL_CALL;
  private tools: readonly BoundTool[] | undefined;

  protected abstract readonly output: z.ZodType<Output>;
  protected abstract readonly finalizeRequest: string;

  protected abstract instructions(request: Request, options: Options): string;

  protected abstract context(request: Request, options: Options): string;

  public constructor() {
    this.spec = harnessSpec(new.target);
  }

  public bind(tools: readonly BoundTool[]): void {
    if (this.tools !== undefined) throw new Error(`the harness ${this.spec.name} already has its tools`);

    this.tools = tools;
  }

  /** The harness's tools inside one run. */
  public toolbox(run: Run): Toolbox {
    this.tools ??= this.spec.tools.map((tool) => ({ spec: toolSpec(tool), handler: new tool() }));

    return new Toolbox(this.tools, run);
  }

  public async run(request: Request, options: Options): Promise<HarnessRun<Output>> {
    const { llm, log, limits, now } = options;
    const run = options.run ?? RunScope.find();

    if (run === undefined) {
      throw new Error(`the harness ${this.spec.name} ran outside a run; open a run or name one in its options`);
    }

    run.expectWorkflow(this.spec.name);
    run.throwFailure();

    const toolbox = this.toolbox(run);
    const instructions = this.instructions(request, options);
    const context = this.context(request, options);
    const budget = new Budget(limits, now);
    const usage = new UsageTally();
    const session = llm.start({ instructions, context, tools: toolbox.specs });
    let reason: PartialReason | undefined = budget.beforeStep();
    let error: string | undefined;
    let thrown: RunFailure | undefined;
    let steps = 0;
    let modelSteps = 0;
    let stepStart = now();
    const halt = (): RunFailure | undefined => run.failure ?? thrown;

    if (reason === undefined) {
      let tools: ToolPhaseOutcome;

      try {
        tools = await session.runTools(
          {
            runTool: async (call) => {
              const halted = halt();

              if (halted !== undefined) throw halted.error;

              const refused: PartialReason | undefined = reason ?? budget.takeToolCall();

              if (refused !== undefined) {
                reason = refused;

                return { id: call.id, name: call.name, output: this.skippedToolCall[refused], isError: true };
              }

              let result: ToolOutcome;

              try {
                result = await toolbox.execute(call.name, call.input);
              } catch (failure) {
                thrown ??= { error: failure };

                throw failure;
              }

              log.info("tool call", {
                harness: this.spec.name,
                tool: call.name,
                input: briefInput(call.input, HarnessBase.LOGGED_INPUT_CHARS),
                ok: result.ok,
                calls: budget.toolCalls,
              });

              return result.ok
                ? { id: call.id, name: call.name, output: result.output, isError: false }
                : { id: call.id, name: call.name, output: result.error, isError: true };
            },
            onRefusedCall: (call, refusal) => {
              reason ??= budget.takeToolCall();
              log.warn("tool call refused", { tool: call.name, error: refusal });
            },
            onCutOffCall: (call) => {
              log.warn("tool call cut off", { tool: call.name });
            },
            shouldStop: () => {
              if (halt() !== undefined) return true;

              reason ??= budget.beforeStep();

              return reason !== undefined;
            },
            onUsage: (call) => {
              usage.add([call]);
              modelSteps++;

              const end = now();

              log.info("model step", {
                harness: this.spec.name,
                step: modelSteps,
                ms: end - stepStart,
                input_tokens: call.inputTokens,
                output_tokens: call.outputTokens,
                cache_read_tokens: call.cacheReadTokens,
              });

              stepStart = end;
            },
          },
          AbortSignal.timeout(budget.stepMs()),
        );
      } catch (failure) {
        const halted = halt();

        throw halted === undefined ? failure : halted.error;
      }

      const halted = halt();

      if (halted !== undefined) throw halted.error;

      steps = tools.steps;

      if (!tools.ok) {
        reason = tools.kind === "aborted" ? "time_budget" : "model_error";
        error = tools.error;
        log.warn("model step failed", { kind: tools.kind, error: tools.error, steps });
      }
    }

    if (reason !== undefined) log.warn("agent stopped early", { reason, steps, tool_calls: budget.toolCalls });

    const finalStart = now();
    const final = await session.finalize(this.finalizeRequest, this.output, AbortSignal.timeout(budget.finalizeMs()));
    const finalTotals = new UsageTally(final.usage).totals;

    usage.add(final.usage);

    log.info("final answer", {
      harness: this.spec.name,
      ok: final.ok,
      ms: now() - finalStart,
      attempts: finalTotals.calls,
      input_tokens: finalTotals.unknownCounts > 0 ? undefined : finalTotals.inputTokens,
      output_tokens: finalTotals.unknownCounts > 0 ? undefined : finalTotals.outputTokens,
    });

    const counts = { toolCalls: budget.toolCalls, steps, usage: usage.calls, totals: usage.totals };

    if (!final.ok) {
      log.warn("final answer failed", { kind: final.kind, error: final.error });

      return {
        value: undefined,
        partialReason: reason ?? (final.kind === "aborted" ? "time_budget" : "model_error"),
        error: final.error,
        ...counts,
      };
    }

    return { value: final.value, partialReason: reason, error, ...counts };
  }
}

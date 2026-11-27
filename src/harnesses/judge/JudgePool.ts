import { Inject, Service } from "@asenajs/ioc";
import { judgeLimitsSchema } from "../../capability/config/schemas/config-schema.ts";
import { UsageTally } from "../../harness-kit/index.ts";
import { errorMessage } from "../../text/text-utils.ts";
import { deadlines, usageEntry } from "../harnesses-utils.ts";
import type { ReviewerFinding } from "../review/types/review.ts";
import { FindingLog } from "./FindingLog.ts";
import { JudgeHarness } from "./JudgeHarness.ts";
import { RecordingLlm } from "./RecordingLlm.ts";
import type {
  FlowStepLimitReason,
  JudgeError,
  JudgeRun,
  JudgeSlot,
  JudgeStepLimits,
  JudgeStepOptions,
  JudgeStepRequest,
  JudgeStepResult,
  JudgeStepState,
} from "./types/judge.ts";

/**
 * Judges every finding in its own judge call, at most `parallel` calls at a time. The calls share one deadline counted
 * from the start of the flow step; a call that fails, throws or finds the deadline passed gives that finding a judge error
 * and leaves the others alone. The flow step is partial only when the time limit leaves a finding with a judge error, also
 * when a call stopped at that limit and its final answer then failed for another reason. The outcomes keep the order of
 * the findings. The pool and its judge harness keep no state of a flow step; it all lives in the flow step's own state.
 */
@Service("kerpeten:judge-pool")
export class JudgePool {
  private static readonly FLOW_STEP_LIMITS: ReadonlySet<string> = new Set(["time_budget"]);

  @Inject(JudgeHarness)
  private readonly harness!: JudgeHarness;

  public async judge(request: JudgeStepRequest, options: JudgeStepOptions): Promise<JudgeStepResult> {
    JudgePool.checkLimits(options.limits);

    const { limits, llm, log, now } = options;

    const state: JudgeStepState = {
      request,
      options,
      window: deadlines(now(), limits.durationMinutes),
      slots: [],
      usage: new UsageTally(),
      toolCalls: 0,
      next: 0,
    };

    const workers = Math.min(limits.parallel, request.findings.length);

    log.info("judge stage started", { findings: request.findings.length, parallel: workers });

    await Promise.all(Array.from({ length: workers }, () => this.work(state)));

    const slots = state.slots.map((slot) => slot ?? JudgePool.missing());

    const partialReason = slots.find((slot) => slot.limit !== undefined)?.limit;

    const totals = state.usage.totals;

    log.info("judge stage ended", {
      judged: slots.filter((slot) => "labels" in slot.outcome).length,
      errors: slots.filter((slot) => "judgeError" in slot.outcome).length,
      input_tokens: totals.inputTokens,
      partial: partialReason,
    });

    return {
      outcomes: slots.map((slot) => slot.outcome),
      usage: usageEntry("judge", llm.provider, llm.model, totals),
      toolCalls: state.toolCalls,
      unknownUsageCalls: totals.unknownCounts,
      partialReason,
    };
  }

  private async work(state: JudgeStepState): Promise<void> {
    while (state.next < state.request.findings.length) {
      const index = state.next;

      state.next++;

      state.slots[index] = await this.judgeOne(state, index);
    }
  }

  private async judgeOne(state: JudgeStepState, index: number): Promise<JudgeSlot> {
    const finding = state.request.findings[index] as ReviewerFinding;
    const { options } = state;
    const log = new FindingLog(options.log, index + 1);
    const start = options.now();

    if (start >= state.window.stepDeadline) return JudgePool.outOfTime(finding, log);

    log.info("judging finding", { of: state.request.findings.length, file: finding.file });

    const recorder = new RecordingLlm(options.llm);

    try {
      const slot = await this.call(state, finding, recorder, log);
      const ms = options.now() - start;

      if ("labels" in slot.outcome) {
        const { verdict, priority, nature } = slot.outcome.labels;

        log.info("finding judged", { file: finding.file, verdict, priority, nature, ms });
      } else {
        log.info("finding not judged", { file: finding.file, reason: slot.outcome.judgeError.reason, ms });
      }

      return slot;
    } finally {
      state.usage.add(recorder.started?.usage.calls ?? []);
    }
  }

  private async call(
    state: JudgeStepState,
    finding: ReviewerFinding,
    recorder: RecordingLlm,
    log: FindingLog,
  ): Promise<JudgeSlot> {
    const { request, options } = state;
    const { limits, now } = options;

    let run: JudgeRun;

    try {
      run = await this.harness.judge(
        {
          finding,
          patch: request.patch,
          ...(request.extraContext === undefined ? {} : { extraContext: request.extraContext }),
          commentLanguage: request.commentLanguage,
          promptVersion: request.promptVersion,
        },
        {
          llm: recorder,
          limits: {
            ...(limits.maxToolCalls === undefined ? {} : { maxToolCalls: limits.maxToolCalls }),
            ...state.window,
          },
          now,
          log,
          ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
        },
      );
    } catch (error) {
      state.toolCalls += Math.min(recorder.started?.toolCalls ?? 0, limits.maxToolCalls ?? Number.POSITIVE_INFINITY);

      log.warn("judge call failed", { file: finding.file, error: errorMessage(error) });

      return { outcome: { judgeError: { reason: "harness_error", message: errorMessage(error) } }, limit: undefined };
    }

    state.toolCalls += run.toolCalls;

    if (run.completed) return { outcome: { labels: run.labels }, limit: undefined };

    const limit = JudgePool.flowStepLimit(run.judgeError.reason) ?? JudgePool.flowStepLimit(run.partialReason);

    return { outcome: { judgeError: run.judgeError }, limit };
  }

  private static outOfTime(finding: ReviewerFinding, log: FindingLog): JudgeSlot {
    const reason: FlowStepLimitReason = "time_budget";

    log.warn("finding not judged", { file: finding.file, reason });

    const judgeError: JudgeError = { reason, message: "the judge time budget was used up before this finding" };

    return { outcome: { judgeError }, limit: reason };
  }

  private static flowStepLimit(reason: string | undefined): FlowStepLimitReason | undefined {
    return reason !== undefined && JudgePool.FLOW_STEP_LIMITS.has(reason) ? (reason as FlowStepLimitReason) : undefined;
  }

  private static missing(): JudgeSlot {
    return {
      outcome: { judgeError: { reason: "harness_error", message: "the finding was not judged" } },
      limit: undefined,
    };
  }

  private static checkLimits(limits: JudgeStepLimits): void {
    const checked = judgeLimitsSchema.safeParse({
      max_judge_parallel: limits.parallel,
      max_judge_tool_calls: limits.maxToolCalls,
      max_judge_duration_minutes: limits.durationMinutes,
    });

    if (!checked.success) throw new RangeError(`judge limits out of range: ${checked.error.message}`);
  }
}

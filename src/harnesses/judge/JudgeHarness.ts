import { Inject } from "@asenajs/ioc";
import { Harness, HarnessBase, type HarnessRun, type PartialReason, UsageTally } from "../../harness-kit/index.ts";
import { errorMessage } from "../../text/text-utils.ts";
import { GlobTool } from "../../tools/glob/GlobTool.ts";
import { GrepTool } from "../../tools/grep/GrepTool.ts";
import { ListDirTool } from "../../tools/list-dir/ListDirTool.ts";
import { ReadFileTool } from "../../tools/read-file/ReadFileTool.ts";
import { usageEntry } from "../harnesses-utils.ts";
import { Prompts } from "../Prompts.ts";
import { reviewerFinding } from "../review/schemas/reviewer-output-schema.ts";
import type { RoleHarnessOptions } from "../types/harnesses.ts";
import { JudgeContext } from "./JudgeContext.ts";
import { JudgeInputError } from "./JudgeInputError.ts";
import { RecordingLlm } from "./RecordingLlm.ts";
import type { RecordingSession } from "./RecordingSession.ts";
import { judgeOutput } from "./schemas/judge-output-schema.ts";
import type {
  JudgeError,
  JudgeErrorReason,
  JudgeOutput,
  JudgeRequest,
  JudgeRun,
  JudgeRunCounts,
} from "./types/judge.ts";

@Harness({
  name: "judge",
  tools: [ListDirTool, ReadFileTool, GrepTool, GlobTool],
  permissions: ["repo:read", "repo:search"],
})
export class JudgeHarness extends HarnessBase<JudgeRequest, JudgeOutput, RoleHarnessOptions> {
  public static readonly FINALIZE_REQUEST =
    "Stop using tools now. Return your verdict and labels for the finding as the structured result, following the instructions. Decide with what you have found so far.";

  private static readonly SKIPPED_CALL_NOTICES: Readonly<Record<PartialReason, string>> = {
    tool_call_budget: "not run: the tool call budget is used up; decide with what you have",
    time_budget: "not run: the time budget is used up; decide with what you have",
    model_error: "not run: the judgement is ending; decide with what you have",
  };

  protected readonly output = judgeOutput;
  protected readonly finalizeRequest = JudgeHarness.FINALIZE_REQUEST;
  protected override readonly skippedToolCall = JudgeHarness.SKIPPED_CALL_NOTICES;

  @Inject(Prompts)
  private readonly prompts!: Prompts;

  protected instructions(request: JudgeRequest): string {
    return this.prompts.render("judge", request.promptVersion, { comment_language: request.commentLanguage });
  }

  protected context(request: JudgeRequest, options: RoleHarnessOptions): string {
    let context: JudgeContext;

    try {
      context = new JudgeContext(request, options.nonce ?? crypto.randomUUID());
    } catch (error) {
      throw new JudgeInputError(errorMessage(error), { cause: error });
    }

    for (const note of context.notes) options.log.warn("judge input shortened", { file: request.finding.file, note });

    return context.text;
  }

  public async judge(request: JudgeRequest, options: RoleHarnessOptions): Promise<JudgeRun> {
    this.prompts.template("judge", request.promptVersion);

    const checked = reviewerFinding.safeParse(request.finding);

    if (!checked.success) {
      return this.failed(request, options, undefined, { reason: "invalid_input", message: checked.error.message });
    }

    const recorder = new RecordingLlm(options.llm);
    let result: HarnessRun<JudgeOutput>;
    let session: RecordingSession | undefined;

    try {
      const running = this.run(request, { ...options, llm: recorder });

      session = recorder.takeStarted();
      result = await running;
    } catch (error) {
      if (!(error instanceof JudgeInputError)) throw error;

      return this.failed(request, options, undefined, { reason: "harness_error", message: error.message });
    }

    if (result.totals.unknownCounts > 0) {
      options.log.warn("model usage without token counts", { calls: result.totals.unknownCounts });
    }

    const counts: JudgeRunCounts = {
      partialReason: result.partialReason,
      usage: usageEntry("judge", options.llm.provider, options.llm.model, result.totals),
      unknownUsageCalls: result.totals.unknownCounts,
      toolCalls: result.toolCalls,
      steps: result.steps,
      promptVersion: request.promptVersion,
    };

    if (result.value === undefined) {
      return this.failed(request, options, counts, {
        reason: JudgeHarness.failureReason(result, session),
        message: result.error ?? "no structured result",
      });
    }

    return { ...counts, completed: true, labels: result.value };
  }

  private static failureReason(
    result: HarnessRun<JudgeOutput>,
    session: RecordingSession | undefined,
  ): JudgeErrorReason {
    const kind = session?.finalFailure;

    if (kind === undefined) return result.partialReason ?? "model_error";

    return kind === "aborted" ? "time_budget" : "model_error";
  }

  private failed(
    request: JudgeRequest,
    options: RoleHarnessOptions,
    counts: JudgeRunCounts | undefined,
    error: JudgeError,
  ): JudgeRun {
    options.log.warn("judge gave no result", {
      file: request.finding.file,
      reason: error.reason,
      error: error.message,
    });

    return {
      ...(counts ?? {
        partialReason: undefined,
        usage: usageEntry("judge", options.llm.provider, options.llm.model, new UsageTally().totals),
        unknownUsageCalls: 0,
        toolCalls: 0,
        steps: 0,
        promptVersion: request.promptVersion,
      }),
      completed: false,
      judgeError: error,
    };
  }
}

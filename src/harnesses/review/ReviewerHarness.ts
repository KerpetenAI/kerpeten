import { Inject } from "@asenajs/ioc";
import { Harness, HarnessBase, type PartialReason } from "@kerpetensh/harness-kit";
import { GlobTool } from "../../tools/glob/GlobTool.ts";
import { GrepTool } from "../../tools/grep/GrepTool.ts";
import { ListDirTool } from "../../tools/list-dir/ListDirTool.ts";
import { ReadFileTool } from "../../tools/read-file/ReadFileTool.ts";
import { usageEntry } from "../harnesses-utils.ts";
import { Prompts } from "../Prompts.ts";
import type { RoleHarnessOptions } from "../types/harnesses.ts";
import { ReviewerContext } from "./ReviewerContext.ts";
import { reviewerOutput } from "./schemas/reviewer-output-schema.ts";
import type { ReviewerOutput, ReviewerRequest, ReviewerRun } from "./types/review.ts";

@Harness({
  name: "reviewer",
  tools: [ListDirTool, ReadFileTool, GrepTool, GlobTool],
  permissions: ["repo:read", "repo:search"],
})
export class ReviewerHarness extends HarnessBase<ReviewerRequest, ReviewerOutput, RoleHarnessOptions> {
  public static readonly FINALIZE_REQUEST =
    "Stop using tools now. Return every defect you found as the structured result, following the instructions. If you found none, return an empty findings list.";

  private static readonly SKIPPED_CALL_NOTICES: Readonly<Record<PartialReason, string>> = {
    tool_call_budget: "not run: the tool call budget is used up; report your findings now",
    time_budget: "not run: the time budget is used up; report your findings now",
    model_error: "not run: the review is ending; report your findings now",
  };

  protected readonly output = reviewerOutput;
  protected readonly finalizeRequest = ReviewerHarness.FINALIZE_REQUEST;
  protected override readonly skippedToolCall = ReviewerHarness.SKIPPED_CALL_NOTICES;

  @Inject(Prompts)
  private readonly prompts!: Prompts;

  protected instructions(request: ReviewerRequest): string {
    return this.prompts.render("reviewer", request.promptVersion, { comment_language: request.commentLanguage });
  }

  protected context(request: ReviewerRequest, options: RoleHarnessOptions): string {
    const context = new ReviewerContext(request, options.nonce ?? crypto.randomUUID());

    for (const note of context.notes) options.log.warn("reviewer input shortened", { note });

    return context.text;
  }

  public async review(request: ReviewerRequest, options: RoleHarnessOptions): Promise<ReviewerRun> {
    const result = await this.run(request, options);
    const usage = usageEntry("reviewer", options.llm.provider, options.llm.model, result.totals);

    if (result.totals.unknownCounts > 0) {
      options.log.warn("model usage without token counts", { calls: result.totals.unknownCounts });
    }

    return {
      completed: result.value !== undefined,
      findings: result.value?.findings ?? [],
      partialReason: result.partialReason,
      error: result.error,
      usage,
      unknownUsageCalls: result.totals.unknownCounts,
      toolCalls: result.toolCalls,
      steps: result.steps,
      promptVersion: request.promptVersion,
    };
  }
}

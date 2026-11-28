import { Inject, Service } from "@asenajs/ioc";
import { type KitInstances, KitNames } from "../../harness-kit/index.ts";
import { CandidateFilter } from "../../harnesses/review/CandidateFilter.ts";
import type { JudgedFinding } from "../../harnesses/review/types/review.ts";
import type { UsageEntry } from "../../harnesses/types/harnesses.ts";
import { safeJson, terminalLine } from "../../text/text-utils.ts";
import type { ReviewedMergeRequest, ReviewResult } from "../review/types/review-workflow.ts";
import type { MergeRequestJson, ReviewJson } from "./types/review-command.ts";

/** Prints the result of a review on stdout, as text or as JSON. */
@Service("kerpeten:review-printer")
export class ReviewPrinter {
  @Inject(KitNames.IO)
  private readonly io!: KitInstances[KitNames.IO];

  public print(result: ReviewResult, json: boolean): void {
    if (!json) {
      this.printText(result);

      return;
    }

    const output: ReviewJson = {
      ...(result.mergeRequest === undefined
        ? {}
        : { merge_request: ReviewPrinter.mergeRequestFields(result.mergeRequest) }),
      findings: result.findings.map((finding) => ReviewPrinter.outputFields(finding)),
      usage: result.usage,
    };

    this.io.out(safeJson(output));
  }

  private static outputFields(finding: JudgedFinding): JudgedFinding {
    const { file, start_line, end_line, category, title, body, fix, evidence } = finding;
    const reviewer = { file, start_line, end_line, category, title, body, fix, evidence };

    if ("judge_error" in finding) return { ...reviewer, judge_error: finding.judge_error, action: finding.action };

    const { verdict, priority, nature, fix_effort, rationale, score, action } = finding;

    return { ...reviewer, verdict, priority, nature, fix_effort, rationale, score, action };
  }

  private static mergeRequestFields(mergeRequest: ReviewedMergeRequest): MergeRequestJson {
    const { tenant, kind, host, projectId, number, title, state, headSha, baseSha } = mergeRequest;

    return {
      tenant,
      platform: { kind, host },
      project: { id: projectId },
      mr: number,
      title,
      state,
      head_sha: headSha,
      base_sha: baseSha,
    };
  }

  private static mergeRequestSummary(mergeRequest: ReviewedMergeRequest): string {
    const { tenant, kind, host, projectId, number, title, state } = mergeRequest;

    return `merge request: #${number} ${terminalLine(title)} (${state}), ${kind} ${terminalLine(host)}, project ${terminalLine(projectId)}, tenant ${terminalLine(tenant)}`;
  }

  private static judgeSummary(finding: JudgedFinding): string {
    if ("judge_error" in finding) return `judge_error ${terminalLine(finding.judge_error)}, action ${finding.action}`;

    return `verdict ${finding.verdict}, priority ${finding.priority}, nature ${finding.nature}, fix_effort ${finding.fix_effort}, score ${finding.score}, action ${finding.action}`;
  }

  private usageSummary(entry: UsageEntry): string {
    const cache = [
      entry.cache_read_tokens === undefined ? undefined : `cache read ${entry.cache_read_tokens}`,
      entry.cache_write_tokens === undefined ? undefined : `cache write ${entry.cache_write_tokens}`,
    ].filter((part) => part !== undefined);

    return `usage: ${entry.role} ${entry.provider}/${entry.model}: ${entry.calls} calls, ${entry.input_tokens} input tokens, ${entry.output_tokens} output tokens${cache.length > 0 ? `, ${cache.join(", ")}` : ""}`;
  }

  private printText(result: ReviewResult): void {
    const { io } = this;

    if (result.mergeRequest !== undefined) io.out(ReviewPrinter.mergeRequestSummary(result.mergeRequest));

    io.out(
      `review: ${result.baseSha.slice(0, 12)}..${result.headSha.slice(0, 12)}, ${result.changedFiles.length} changed files, prompt reviewer ${result.promptVersion}`,
    );

    if (result.reviewerPartialReason !== undefined) io.out(`review: PARTIAL (${result.reviewerPartialReason})`);
    if (result.judgePartialReason !== undefined) io.out(`judge: PARTIAL (${result.judgePartialReason})`);

    io.out(`findings: ${result.findings.length}`);

    for (const finding of result.findings) {
      io.out(
        `- ${terminalLine(finding.file)}:${finding.start_line}-${finding.end_line} [${finding.category}] ${terminalLine(finding.title)}`,
      );

      io.out(`  ${ReviewPrinter.judgeSummary(finding)}`);

      io.out(`  ${terminalLine(finding.body)}`);

      io.out(`  fix ${terminalLine(finding.fix)}`);

      if (!("judge_error" in finding)) io.out(`  rationale ${terminalLine(finding.rationale)}`);

      for (const item of finding.evidence) {
        io.out(
          `  evidence ${terminalLine(item.location)}${item.note === undefined ? "" : `: ${terminalLine(item.note)}`}`,
        );
      }
    }

    const dropped = Object.entries(result.dropped);

    if (dropped.length > 0) io.out(`dropped: ${dropped.map(([reason, count]) => `${reason} ${count}`).join(", ")}`);
    if (result.clipped > 0) io.out(`clipped to ${CandidateFilter.MAX_FINDING_LINES} lines: ${result.clipped}`);
    for (const entry of result.usage) io.out(this.usageSummary(entry));

    io.out(`tool calls: ${result.toolCalls}`);

    io.out(`judge tool calls: ${result.judgeToolCalls}`);
  }
}

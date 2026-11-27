import { GitDiff } from "../../capability/git/GitDiff.ts";
import { Context, ContextBase, contextSpec } from "../../harness-kit/index.ts";
import { cut, shortLine } from "../../text/text-utils.ts";
import type { ReviewerFinding } from "../review/types/review.ts";
import type { FileDiff, JudgeContextSpec, JudgeRequest } from "./types/judge.ts";

@Context({
  MAX_DIFF_CHARS: 100_000,
  MAX_TEXT_CHARS: 20_000,
  MAX_EVIDENCE_ITEMS: 50,
  MAX_LINE_CHARS: 500,
  NO_DIFF: "(no diff for this file)",
  DIFF_HEADER: "diff --git ",
})
export class JudgeContext extends ContextBase<JudgeContextSpec, JudgeRequest> {
  protected sections(request: JudgeRequest, notes: string[]): readonly string[] {
    const finding = JudgeContext.findingText(request.finding, notes);
    const diff = JudgeContext.fileDiff(request.patch, request.finding.file);
    const patch = cut(diff.text, this.spec.MAX_DIFF_CHARS);

    if (patch.cut) notes.push(`diff cut at ${this.spec.MAX_DIFF_CHARS} characters`);

    let heading = "Diff of the finding's file (unified, a/ is the base, b/ is the head):";

    if (!diff.found) heading = "Diff of the finding's file (no diff is given for this file; use the tools):";
    else if (patch.cut)
      heading = `Diff of the finding's file (cut at ${this.spec.MAX_DIFF_CHARS} characters; the file at the head commit holds the new code of the cut part but not its removed lines, read only the lines you need):`;

    return [
      "Candidate finding:",
      this.dataBlock("finding", finding),
      "",
      heading,
      this.dataBlock("diff", diff.found ? patch.text : this.spec.NO_DIFF),
      "",
      ...(request.extraContext === undefined
        ? []
        : [
            "Extra context, given by the person who started the review:",
            this.dataBlock("extra-context", request.extraContext),
            "",
          ]),
      "Try to refute the finding first. Use a tool only for a fact you still need. When you have decided, reply briefly without a tool call; you are then asked for the labels as a structured result.",
    ];
  }

  public static fileDiff(patch: string, file: string): FileDiff {
    const spec = contextSpec(JudgeContext);
    const kept = GitDiff.filterPatch(patch, (path) => path === file);

    if (kept.startsWith(spec.DIFF_HEADER)) return { text: kept, found: true };

    const at = kept.indexOf(`\n${spec.DIFF_HEADER}`);

    return at < 0 ? { text: "", found: false } : { text: kept.slice(at + 1), found: true };
  }

  private static findingText(finding: ReviewerFinding, notes: string[]): string {
    const spec = contextSpec(JudgeContext);
    const title = cut(finding.title, spec.MAX_TEXT_CHARS);
    const body = cut(finding.body, spec.MAX_TEXT_CHARS);

    if (title.cut || body.cut) notes.push("finding text cut");

    const shown = finding.evidence.slice(0, spec.MAX_EVIDENCE_ITEMS);
    const omitted = finding.evidence.length - shown.length;

    if (omitted > 0) notes.push(`${omitted} evidence items left out`);

    const evidence = shown.map((item) => {
      const location = shortLine(item.location, spec.MAX_LINE_CHARS);

      return item.note === undefined ? `- ${location}` : `- ${location}: ${shortLine(item.note, spec.MAX_LINE_CHARS)}`;
    });

    return [
      `file: ${shortLine(finding.file, spec.MAX_LINE_CHARS)}`,
      `lines: ${finding.start_line}-${finding.end_line}`,
      `category: ${finding.category}`,
      `title: ${title.text}`,
      "body:",
      body.text,
      "evidence:",
      ...evidence,
    ].join("\n");
  }
}

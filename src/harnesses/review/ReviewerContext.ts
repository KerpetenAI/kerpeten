import { Context, ContextBase, contextSpec } from "../../harness-kit/index.ts";
import { LineSplitter } from "../../text/LineSplitter.ts";
import { cut, shortLine } from "../../text/text-utils.ts";
import type { DiscussedFinding, ListBlock, ReviewerContextSpec, ReviewerRequest, RuleFile } from "./types/review.ts";

@Context({
  MAX_PATCH_CHARS: 400_000,
  MAX_DISCUSSED_ITEMS: 200,
  MAX_DISCUSSED_CHARS: 40_000,
  MAX_TEXT_CHARS: 20_000,
  MAX_CHANGED_FILES: 2_000,
  MAX_CHANGED_FILES_CHARS: 100_000,
  MAX_RULE_FILE_CHARS: 40_000,
})
export class ReviewerContext extends ContextBase<ReviewerContextSpec, ReviewerRequest> {
  protected sections(request: ReviewerRequest, notes: string[]): readonly string[] {
    const title = cut(request.title, this.spec.MAX_TEXT_CHARS);
    const description = cut(request.description, this.spec.MAX_TEXT_CHARS);
    const patch = cut(request.patch, this.spec.MAX_PATCH_CHARS);

    if (title.cut || description.cut) notes.push("merge request text cut");
    if (patch.cut) notes.push(`diff cut at ${this.spec.MAX_PATCH_CHARS} characters`);

    const discussed = ReviewerContext.discussedBlock(request.known);

    if (discussed.omitted > 0) notes.push(`${discussed.omitted} known findings left out`);

    const changed = ReviewerContext.changedFilesBlock(request.changedFiles);

    if (changed.omitted > 0) notes.push(`${changed.omitted} changed files left out`);

    const rules =
      request.rules.length === 0
        ? [
            "Project rule files (AGENTS.md and CLAUDE.md in the repository root):",
            this.dataBlock("rules", "(none)"),
            "",
          ]
        : request.rules.flatMap((file) => this.ruleBlock(file, notes));

    return [
      "Merge request title:",
      this.dataBlock("title", title.text),
      "",
      "Merge request description:",
      this.dataBlock("description", description.text),
      "",
      changed.omitted > 0
        ? `Changed files (first ${request.changedFiles.length - changed.omitted} of ${request.changedFiles.length}; the diff and the tools show the rest):`
        : "Changed files:",
      this.dataBlock("changed-files", changed.text),
      "",
      patch.cut
        ? `Diff (cut at ${this.spec.MAX_PATCH_CHARS} characters; the files at the head commit hold the new code of the cut part but not its removed lines, read only the lines you need):`
        : "Diff (unified, a/ is the base, b/ is the head):",
      this.dataBlock("diff", patch.text),
      "",
      "Already discussed or known findings (do not report these again):",
      this.dataBlock("discussed", discussed.text),
      "",
      ...rules,
      ...(request.extraContext === undefined
        ? []
        : [
            "Extra context, given by the person who started the review:",
            this.dataBlock("extra-context", request.extraContext),
            "",
          ]),
      "Review the change now. Use a tool only to settle a concrete suspicion. When you are done, reply briefly without a tool call; you are then asked for the findings as a structured result.",
    ];
  }

  public static discussedBlock(known: readonly DiscussedFinding[]): ListBlock {
    const spec = contextSpec(ReviewerContext);
    const lines: string[] = [];
    let size = 0;

    for (const item of known) {
      if (lines.length >= spec.MAX_DISCUSSED_ITEMS) break;

      const reason = item.reason === undefined ? "" : ` (marked as not a defect: ${shortLine(item.reason, 500)})`;
      const line = `- known: ${shortLine(item.file, 500)}: ${shortLine(item.title, 500)}${reason}`;

      if (size + line.length + 1 > spec.MAX_DISCUSSED_CHARS) break;

      lines.push(line);
      size += line.length + 1;
    }

    return { text: lines.length === 0 ? "(none)" : lines.join("\n"), omitted: known.length - lines.length };
  }

  public static changedFilesBlock(files: readonly string[]): ListBlock {
    const spec = contextSpec(ReviewerContext);
    const lines: string[] = [];
    let size = 0;

    for (const file of files) {
      if (lines.length >= spec.MAX_CHANGED_FILES) break;

      const added = lines.length === 0 ? file.length : file.length + 1;

      if (size + added > spec.MAX_CHANGED_FILES_CHARS) break;

      lines.push(file);
      size += added;
    }

    return { text: lines.length === 0 ? "(none)" : lines.join("\n"), omitted: files.length - lines.length };
  }

  private ruleBlock(file: RuleFile, notes: string[]): readonly string[] {
    const max = this.spec.MAX_RULE_FILE_CHARS;
    const text = cut(file.text, max);

    if (text.cut) notes.push(`${file.name} cut at ${max} characters`);

    const lines = LineSplitter.split(text.text).map((line, index) => `${index + 1}\t${line}`);

    const details = [
      ...(file.sameText.length === 0 ? [] : [`${file.sameText.join(" and ")} has the same text`]),
      "each line starts with its number and a tab",
      ...(text.cut ? [`cut at ${max} characters; read the rest with read_file`] : []),
    ];

    return [
      `Project rule file ${file.name} (${details.join("; ")}):`,
      this.dataBlock(`rules-${file.name}`, lines.join("\n")),
      "",
    ];
  }
}

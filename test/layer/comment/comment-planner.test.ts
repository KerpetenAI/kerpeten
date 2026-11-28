import { describe, expect, test } from "bun:test";
import { CommentMarker } from "../../../src/layer/comment/CommentMarker.ts";
import { CommentPlanner } from "../../../src/layer/comment/CommentPlanner.ts";
import type { WrittenComment } from "../../../src/layer/comment/types/comment.ts";
import { component } from "../../harnesses/harnesses-utils.ts";
import {
  actions,
  finding,
  findingMarker,
  HEAD,
  NOTE,
  OTHER_HEAD,
  planInput,
  TURKISH_NOTE,
  unjudged,
  writtenLine,
} from "./comment-utils.ts";

const planner = await component(CommentPlanner, [CommentPlanner]);

const SUMMARY_MARKER = `<!-- kerpeten:summary v1 head=${HEAD} -->`;

const NOTHING = [
  "## Kerpeten review",
  `Reviewed commit ${HEAD}. Line comments in this run: 0.`,
  "The review found nothing to report.",
  SUMMARY_MARKER,
].join("\n\n");

describe("comment planner: stored findings", () => {
  test("a refuted finding, one the judge did not label and one under the threshold stay stored and are never written", () => {
    const refuted = finding({ title: "Refuted", verdict: "refuted", score: 0, action: "stored" });
    const low = finding({ title: "Low", score: 15, action: "stored" });
    const failed = unjudged({ title: "Unjudged" });
    const plan = planner.plan(planInput([refuted, low, failed]));

    expect(actions(plan.findings)).toEqual(["Refuted: stored", "Low: stored", "Unjudged: stored"]);
    expect(plan.findings).toEqual([refuted, low, failed]);
    expect(plan.lineComments).toEqual([]);
    expect(plan.summary).toEqual({ body: NOTHING, omitted: 0 });
    expect(plan.counts).toEqual({ inline: 0, summary: 0, duplicate: 0, stored: 3 });
  });

  test("a stored finding stays stored when a line comment for its lines is already written", () => {
    const low = finding({ title: "Low", score: 15, action: "stored" });
    const plan = planner.plan(planInput([low, unjudged()], { written: [writtenLine("src/a.ts", 6, 6)] }));

    expect(plan.findings.map((planned) => planned.action)).toEqual(["stored", "stored"]);
    expect(plan.counts).toEqual({ inline: 0, summary: 0, duplicate: 0, stored: 2 });
  });

  test("a run without a finding still has a summary, which says that nothing was found", () => {
    const plan = planner.plan(planInput([]));

    expect(plan).toEqual({
      findings: [],
      lineComments: [],
      summary: { body: NOTHING, omitted: 0 },
      counts: { inline: 0, summary: 0, duplicate: 0, stored: 0 },
    });
  });
});

describe("comment planner: findings that are already written", () => {
  test("a line comment of Kerpeten with the same commit, file and lines makes the finding a duplicate that is not written", () => {
    const first = finding({ title: "Written" });
    const second = finding({ title: "New", start_line: 22, end_line: 23 });
    const plan = planner.plan(planInput([first, second], { written: [writtenLine("src/a.ts", 6, 6)] }));

    expect(actions(plan.findings)).toEqual(["Written: suppressed_duplicate", "New: inline"]);
    expect(plan.lineComments.map((comment) => comment.startLine)).toEqual([22]);
    expect(plan.summary.body).not.toContain("Written");
    expect(plan.summary.body).toContain("Line comments in this run: 1. Findings that already had a line comment: 1.");
    expect(plan.counts).toEqual({ inline: 1, summary: 0, duplicate: 1, stored: 0 });
  });

  test("a finding the scorer gave the summary is a duplicate too when its line comment is there", () => {
    const plan = planner.plan(
      planInput([finding({ score: 40, action: "summary" })], { written: [writtenLine("src/a.ts", 6, 6)] }),
    );

    expect(plan.findings.map((planned) => planned.action)).toEqual(["suppressed_duplicate"]);
    expect(plan.summary.body).not.toContain("###");
  });

  test("another commit, another file, another first or last line make no duplicate", () => {
    const others = [
      writtenLine("src/a.ts", 6, 6, OTHER_HEAD),
      writtenLine("src/b.ts", 6, 6),
      writtenLine("src/a.ts", 5, 6),
      writtenLine("src/a.ts", 6, 7),
    ];

    const plan = planner.plan(planInput([finding()], { written: others }));

    expect(plan.findings.map((planned) => planned.action)).toEqual(["inline"]);
  });

  test("a marker in a comment that sits on no line, and a summary marker, make no duplicate", () => {
    const general: WrittenComment = { kind: "general", mark: CommentMarker.finding(HEAD, "src/a.ts", 6, 6).mark };
    const summaryOnLine: WrittenComment = { kind: "line", mark: CommentMarker.summary(HEAD).mark };
    const summary: WrittenComment = { kind: "general", mark: CommentMarker.summary(HEAD).mark };
    const plan = planner.plan(planInput([finding()], { written: [general, summaryOnLine, summary] }));

    expect(plan.findings.map((planned) => planned.action)).toEqual(["inline"]);
  });

  test("duplicates are taken out before the limit, so they do not count against it", () => {
    const findings = [
      finding({ title: "Written top", score: 95 }),
      finding({ title: "Second", start_line: 4, end_line: 4, score: 80 }),
      finding({ title: "Third", start_line: 22, end_line: 22, score: 70 }),
      finding({ title: "Fourth", start_line: 24, end_line: 24, score: 65 }),
    ];

    const plan = planner.plan(planInput(findings, { maxInlineComments: 2, written: [writtenLine("src/a.ts", 6, 6)] }));

    expect(actions(plan.findings)).toEqual([
      "Written top: suppressed_duplicate",
      "Second: inline",
      "Third: inline",
      "Fourth: summary",
    ]);

    expect(plan.counts).toEqual({ inline: 2, summary: 1, duplicate: 1, stored: 0 });
  });
});

describe("comment planner: line comments", () => {
  test("a finding the scorer gave a line comment gets one when its whole range lies in one hunk", () => {
    const inside = finding({ start_line: 3, end_line: 9 });
    const plan = planner.plan(planInput([inside]));

    expect(plan.findings).toEqual([inside]);
    expect(plan.lineComments.length).toBe(1);
    expect(plan.lineComments[0]).toMatchObject({ file: "src/a.ts", startLine: 3, endLine: 9, cut: false });
    expect(plan.lineComments[0]?.body.endsWith(`\n\n${NOTE}\n${findingMarker(inside)}`)).toBe(true);

    expect(plan.summary.body).toBe(
      ["## Kerpeten review", `Reviewed commit ${HEAD}. Line comments in this run: 1.`, SUMMARY_MARKER].join("\n\n"),
    );
  });

  test("a range that touches the edge of a hunk stays on its lines, one line further goes to the summary", () => {
    const findings = [
      finding({ title: "First line of the hunk", start_line: 3, end_line: 3 }),
      finding({ title: "Last line of the hunk", start_line: 9, end_line: 9 }),
      finding({ title: "One line before", start_line: 2, end_line: 3 }),
      finding({ title: "One line after", start_line: 9, end_line: 10 }),
      finding({ title: "Across two hunks", start_line: 8, end_line: 21 }),
      finding({ title: "Between the hunks", start_line: 14, end_line: 14 }),
    ];

    expect(actions(planner.plan(planInput(findings)).findings)).toEqual([
      "First line of the hunk: inline",
      "Last line of the hunk: inline",
      "One line before: summary",
      "One line after: summary",
      "Across two hunks: summary",
      "Between the hunks: summary",
    ]);
  });

  test("a file that is not in the diff, a deleted file and the old path of a renamed file go to the summary", () => {
    const findings = [
      finding({ title: "Not in the diff", file: "src/untouched.ts" }),
      finding({ title: "Deleted", file: "src/gone.ts", start_line: 1, end_line: 1 }),
      finding({ title: "Old path", file: "src/old name.ts", start_line: 2, end_line: 2 }),
      finding({ title: "New path", file: "src/new name.ts", start_line: 2, end_line: 2 }),
      finding({ title: "Added", file: "src/added.ts", start_line: 1, end_line: 2 }),
    ];

    const plan = planner.plan(planInput(findings));

    expect(actions(plan.findings)).toEqual([
      "Not in the diff: summary",
      "Deleted: summary",
      "Old path: summary",
      "New path: inline",
      "Added: inline",
    ]);

    expect(plan.summary.body).toContain("### Not in the diff\n`src/untouched.ts:6` · bug · P1");
    expect(plan.summary.body).toContain("### Deleted\n`src/gone.ts:1` · bug · P1");
  });

  test("a finding the scorer gave the summary stays in the summary, also inside a hunk", () => {
    const plan = planner.plan(planInput([finding({ score: 40, action: "summary" })]));

    expect(plan.findings.map((planned) => planned.action)).toEqual(["summary"]);
    expect(plan.lineComments).toEqual([]);
    expect(plan.summary.body).toContain("### Division by zero is not handled\n`src/a.ts:6` · bug · P1");
    expect(plan.counts).toEqual({ inline: 0, summary: 1, duplicate: 0, stored: 0 });
  });
});

describe("comment planner: the limit of line comments", () => {
  const findings = [
    finding({ title: "Low", start_line: 4, end_line: 4, score: 61 }),
    finding({ title: "High", start_line: 22, end_line: 22, score: 95 }),
    finding({ title: "Middle", start_line: 6, end_line: 6, score: 80 }),
    finding({ title: "Outside a hunk", start_line: 14, end_line: 14, score: 99 }),
    finding({ title: "Scored for the summary", start_line: 5, end_line: 5, score: 30, action: "summary" }),
  ];

  test("with more findings than the limit, the highest scores keep their lines and the others go to the summary", () => {
    const plan = planner.plan(planInput(findings, { maxInlineComments: 2 }));

    expect(actions(plan.findings)).toEqual([
      "Low: summary",
      "High: inline",
      "Middle: inline",
      "Outside a hunk: summary",
      "Scored for the summary: summary",
    ]);

    expect(plan.lineComments.map((comment) => comment.startLine)).toEqual([22, 6]);

    expect(plan.summary.body.match(/^### .*$/gm)).toEqual([
      "### Outside a hunk",
      "### Low",
      "### Scored for the summary",
    ]);

    expect(plan.counts).toEqual({ inline: 2, summary: 3, duplicate: 0, stored: 0 });
  });

  test("a finding that cannot sit on its lines takes no place of the limit", () => {
    const plan = planner.plan(planInput(findings, { maxInlineComments: 3 }));

    expect(plan.lineComments.map((comment) => comment.startLine)).toEqual([22, 6, 4]);
  });

  test("with the limit 0 every finding goes to the summary", () => {
    const plan = planner.plan(planInput(findings, { maxInlineComments: 0 }));

    expect(plan.lineComments).toEqual([]);
    expect(plan.findings.every((planned) => planned.action === "summary")).toBe(true);
    expect(plan.summary.body).toContain("Line comments in this run: 0.\n\n### Outside a hunk");
  });

  test("equal scores are ordered by the file, then the first line, then the title", () => {
    const equal = [
      finding({ title: "b title", file: "src/a.ts", start_line: 22, end_line: 22 }),
      finding({ title: "a title", file: "src/a.ts", start_line: 22, end_line: 22 }),
      finding({ title: "z title", file: "src/a.ts", start_line: 4, end_line: 4 }),
      finding({ title: "y title", file: "src/added.ts", start_line: 1, end_line: 1 }),
      finding({ title: "x title", file: "src/Zed.ts", start_line: 1, end_line: 1, action: "summary" }),
      finding({ title: "higher", file: "src/new name.ts", start_line: 1, end_line: 1, score: 70.01 }),
    ];

    const plan = planner.plan(planInput(equal, { maxInlineComments: 3 }));

    expect(actions(plan.findings)).toEqual([
      "b title: summary",
      "a title: inline",
      "z title: inline",
      "y title: summary",
      "x title: summary",
      "higher: inline",
    ]);

    expect(plan.lineComments.map((comment) => `${comment.file}:${comment.startLine}`)).toEqual([
      "src/new name.ts:1",
      "src/a.ts:4",
      "src/a.ts:22",
    ]);

    expect(plan.summary.body.match(/^### .*$/gm)).toEqual(["### x title", "### b title", "### y title"]);
  });

  test("a limit that is no count is refused", () => {
    expect(() => planner.plan(planInput([], { maxInlineComments: -1 }))).toThrow("not a count of line comments: -1");
    expect(() => planner.plan(planInput([], { maxInlineComments: 1.5 }))).toThrow("not a count of line comments: 1.5");
  });
});

describe("comment planner: the same input gives the same plan", () => {
  const findings = [
    finding({ title: "One", start_line: 4, end_line: 4, score: 90 }),
    finding({ title: "Two", start_line: 22, end_line: 22, score: 90 }),
    finding({ title: "Three", start_line: 6, end_line: 6, score: 90 }),
    finding({ title: "Four", file: "src/untouched.ts", score: 75 }),
    finding({ title: "Five", start_line: 24, end_line: 24, score: 45, action: "summary" }),
    finding({ title: "Six", start_line: 25, end_line: 25, score: 45, action: "summary" }),
    finding({ title: "Seven", score: 10, action: "stored" }),
    unjudged({ title: "Eight" }),
    finding({ title: "Nine", file: "src/added.ts", start_line: 1, end_line: 1, score: 88 }),
  ];

  const input = planInput(findings, {
    maxInlineComments: 2,
    written: [writtenLine("src/added.ts", 1, 1)],
    partialReason: "time_budget",
  });

  test("a second run gives an equal plan", () => {
    expect(planner.plan(input)).toEqual(planner.plan(input));
    expect(JSON.stringify(planner.plan(input))).toBe(JSON.stringify(planner.plan(planInput(findings, input))));
  });

  test("the order the findings come in changes neither the comments nor an action, only the order of the findings", () => {
    const plan = planner.plan(input);

    const reversed = planner.plan({
      ...input,
      findings: [...findings].reverse(),
      written: [...input.written].reverse(),
    });

    const rotated = planner.plan({ ...input, findings: [...findings.slice(4), ...findings.slice(0, 4)] });

    for (const other of [reversed, rotated]) {
      expect(other.lineComments).toEqual(plan.lineComments);
      expect(other.summary).toEqual(plan.summary);
      expect(other.counts).toEqual(plan.counts);
      expect(actions(other.findings).sort()).toEqual(actions(plan.findings).sort());
    }

    expect(actions(plan.findings)).toEqual([
      "One: inline",
      "Two: summary",
      "Three: inline",
      "Four: summary",
      "Five: summary",
      "Six: summary",
      "Seven: stored",
      "Eight: stored",
      "Nine: suppressed_duplicate",
    ]);

    expect(actions(reversed.findings)).toEqual(actions(plan.findings).reverse());
    expect(plan.counts).toEqual({ inline: 2, summary: 4, duplicate: 1, stored: 2 });
  });

  test("every finding has exactly one action and is written at most once", () => {
    const plan = planner.plan(input);
    const { inline, summary, duplicate, stored } = plan.counts;

    expect(plan.findings.length).toBe(findings.length);
    expect(inline + summary + duplicate + stored).toBe(findings.length);
    expect(plan.lineComments.length).toBe(inline);
    expect(plan.summary.body.match(/^### /gm)?.length).toBe(summary);

    for (const title of ["Seven", "Eight", "Nine"]) expect(plan.summary.body).not.toContain(`### ${title}`);
  });
});

describe("comment planner: the summary of a review", () => {
  test("a partial review says so with its reason, and still lists its findings", () => {
    const plan = planner.plan(planInput([finding({ score: 40, action: "summary" })], { partialReason: "time_budget" }));

    expect(plan.summary.body).toContain(
      "\n\n**Partial review:** the review stopped early (`time_budget`), so it may have missed findings.\n\n### Division",
    );

    expect(planner.plan(planInput([])).summary.body).not.toContain("Partial review");
  });

  test("the comment language tr gives the Turkish texts, every other the English ones", () => {
    for (const language of ["tr", "tr-TR"]) {
      const plan = planner.plan(planInput([finding()], { language }));

      expect(plan.lineComments[0]?.body).toContain(
        `\n\n**Düzeltme:** Check b before dividing.\n\n${TURKISH_NOTE}\n<!--`,
      );

      expect(plan.summary.body).toStartWith("## Kerpeten incelemesi\n\nİncelenen commit: ");
    }

    for (const language of ["en", "de", "pt-BR"]) {
      const plan = planner.plan(planInput([finding()], { language }));

      expect(plan.lineComments[0]?.body).toContain(`\n\n**Fix:** Check b before dividing.\n\n${NOTE}\n<!--`);
      expect(plan.summary.body).toStartWith("## Kerpeten review\n\nReviewed commit ");
    }
  });

  test("a commit that is no commit id is refused", () => {
    expect(() => planner.plan(planInput([], { headSha: "main" }))).toThrow("a commit of 40 hex characters");
  });
});

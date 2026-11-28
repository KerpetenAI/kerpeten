import type { Finding } from "../../../api/types/api.generated.ts";
import type {
  JudgedFinding,
  JudgeErrorFields,
  JudgeLabelFields,
  ReviewerFinding,
} from "../../../harnesses/review/types/review.ts";
import type { CommentableLines } from "../CommentableLines.ts";

/**
 * What a review does with a finding on a merge request: a comment on its lines, an entry of the summary comment,
 * nothing because it is only stored, or nothing because a line comment for it is already there.
 */
export type PlannedAction = Extract<Finding["action"], "inline" | "summary" | "stored" | "suppressed_duplicate">;

/** A judged finding with the action the comment plan gives it. A finding the judge did not label stays stored. */
export type PlannedFinding =
  | (ReviewerFinding & Omit<JudgeLabelFields, "action"> & { readonly action: PlannedAction })
  | (ReviewerFinding & JudgeErrorFields);

/** A finding as the comment plan orders and writes it: judged, with the scorer's action or the plan's. */
export type RankedFinding = JudgedFinding | PlannedFinding;

/** Where a finding points: its file and its first and last line. */
export type FindingPlace = Pick<Finding, "file" | "start_line" | "end_line">;

/** Lines of a file from `start` to `end`, both counted. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** What the hidden marker of a line comment says: the commit the review was of, and the finding's file and lines. */
export interface FindingMark {
  readonly kind: "finding";
  readonly version: number;
  readonly headSha: string;
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
}

/** What the hidden marker of the summary comment says: the commit the review was of. */
export interface SummaryMark {
  readonly kind: "summary";
  readonly version: number;
  readonly headSha: string;
}

export type CommentMark = FindingMark | SummaryMark;

/**
 * A comment of Kerpeten that is already on the merge request: whether it sits on lines or belongs to the merge
 * request as a whole, and what its marker says. The marker makes it Kerpeten's, never its author.
 */
export interface WrittenComment {
  readonly kind: "line" | "general";
  readonly mark: CommentMark;
}

/**
 * What the comment plan is made from. `partialReason` is given when the review ended early. `language` is the comment
 * language of the configuration; it chooses the fixed texts.
 */
export interface CommentPlanInput {
  readonly findings: readonly JudgedFinding[];
  readonly lines: CommentableLines;
  readonly written: readonly WrittenComment[];
  readonly headSha: string;
  readonly maxInlineComments: number;
  readonly language: string;
  readonly partialReason?: string;
}

/** A comment on lines of a file, with the text to write. `cut` says that a part of the finding's text did not fit. */
export interface LineComment {
  readonly file: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly body: string;
  readonly cut: boolean;
}

/**
 * The one summary comment of a merge request, with the text to write. `omitted` counts the findings of the summary
 * that the text does not show because it would be too long; the text says the same number.
 */
export interface SummaryComment {
  readonly body: string;
  readonly omitted: number;
}

/** How many findings got each action. */
export interface CommentPlanCounts {
  readonly inline: number;
  readonly summary: number;
  readonly duplicate: number;
  readonly stored: number;
}

/**
 * What a review would write to a merge request: every finding in the order it was given, with its action, the line
 * comments and the summary comment. Nothing of it is written by the plan itself.
 */
export interface CommentPlan {
  readonly findings: readonly PlannedFinding[];
  readonly lineComments: readonly LineComment[];
  readonly summary: SummaryComment;
  readonly counts: CommentPlanCounts;
}

/** What the summary comment says beside its findings. */
export interface SummaryFacts {
  readonly lineComments: number;
  readonly alreadyWritten: number;
  readonly partialReason?: string;
}

/** The fixed texts of a comment in one language. */
export interface CommentWordSet {
  readonly heading: string;
  readonly fix: string;
  readonly thumbsDown: string;
  readonly nothing: string;
  readonly untitled: string;
  readonly cut: string;
  reviewed(commit: string, lineComments: number, alreadyWritten: number): string;
  partial(reason: string): string;
  omitted(count: number): string;
}

/** An open fenced code block: the character and the length of its fence, and how far the fence was indented. */
export interface CodeFence {
  readonly char: string;
  readonly length: number;
  readonly indent: number;
}

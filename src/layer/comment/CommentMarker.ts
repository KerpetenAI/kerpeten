import type { CommentMark } from "./types/comment.ts";

/**
 * The hidden marker that ends every comment Kerpeten writes: an HTML comment, so a reader of the merge request does
 * not see it. It writes a marker and reads it back from the text of a comment.
 *
 * A line comment ends with `<!-- kerpeten:finding v1 head=<commit> file=<path> lines=<start>-<end> -->`, the summary
 * comment with `<!-- kerpeten:summary v1 head=<commit> -->`. The commit is the 40 hex characters of the commit the
 * review was of. The path is written as base64url of its UTF-8 bytes, so no character of a path can end the HTML
 * comment or add a field, and the reader gets the exact path back.
 *
 * The reader takes a marker only as the last line of the text that is not empty, and only when the whole line fits
 * the pattern. A marker anywhere else in the text, one of another version and one that is not written the one way the
 * writer writes it are no marker.
 */
export class CommentMarker {
  public static readonly VERSION = 1;

  public static readonly MAX_LINE = 999_999_999;

  private static readonly SHA = /^[0-9a-f]{40}$/;

  private static readonly FINDING = new RegExp(
    `^<!-- kerpeten:finding v${CommentMarker.VERSION} head=([0-9a-f]{40}) file=([A-Za-z0-9_-]+) lines=([1-9][0-9]{0,8})-([1-9][0-9]{0,8}) -->$`,
  );

  private static readonly SUMMARY = new RegExp(
    `^<!-- kerpeten:summary v${CommentMarker.VERSION} head=([0-9a-f]{40}) -->$`,
  );

  private static readonly LINE_END = /\r\n|\r|\n/;

  public readonly mark: CommentMark;

  private constructor(mark: CommentMark) {
    this.mark = mark;
  }

  /** The marker of a line comment for the finding at lines `startLine` to `endLine` of `file`, reviewed at `headSha`. */
  public static finding(headSha: string, file: string, startLine: number, endLine: number): CommentMarker {
    CommentMarker.assertSha(headSha);

    if (file === "" || !file.isWellFormed()) {
      throw new RangeError(`a comment marker cannot hold the path ${JSON.stringify(file)}`);
    }

    if (!CommentMarker.isLine(startLine) || !CommentMarker.isLine(endLine) || startLine > endLine) {
      throw new RangeError(`a comment marker cannot hold the lines ${startLine}-${endLine}`);
    }

    return new CommentMarker({ kind: "finding", version: CommentMarker.VERSION, headSha, file, startLine, endLine });
  }

  /** The marker of the summary comment of a review at `headSha`. */
  public static summary(headSha: string): CommentMarker {
    CommentMarker.assertSha(headSha);

    return new CommentMarker({ kind: "summary", version: CommentMarker.VERSION, headSha });
  }

  /** The marker that ends `text`, or `undefined` when its last line that is not empty is no marker. */
  public static read(text: string): CommentMarker | undefined {
    const line = text.split(CommentMarker.LINE_END).findLast((candidate) => candidate.trim() !== "");

    if (line === undefined) return undefined;

    const summary = CommentMarker.SUMMARY.exec(line);

    if (summary !== null) return CommentMarker.summary(summary[1] ?? "");

    const finding = CommentMarker.FINDING.exec(line);

    if (finding === null) return undefined;

    const file = CommentMarker.decoded(finding[2] ?? "");
    const startLine = Number(finding[3]);
    const endLine = Number(finding[4]);

    if (file === undefined || startLine > endLine) return undefined;

    return CommentMarker.finding(finding[1] ?? "", file, startLine, endLine);
  }

  /** The marker as the one line that ends a comment. */
  public line(): string {
    const { mark } = this;

    if (mark.kind === "summary") return `<!-- kerpeten:summary v${mark.version} head=${mark.headSha} -->`;

    const file = Buffer.from(mark.file, "utf8").toString("base64url");

    return `<!-- kerpeten:finding v${mark.version} head=${mark.headSha} file=${file} lines=${mark.startLine}-${mark.endLine} -->`;
  }

  private static assertSha(headSha: string): void {
    if (!CommentMarker.SHA.test(headSha)) {
      throw new RangeError(`a comment marker needs a commit of 40 hex characters, not ${JSON.stringify(headSha)}`);
    }
  }

  private static isLine(line: number): boolean {
    return Number.isSafeInteger(line) && line >= 1 && line <= CommentMarker.MAX_LINE;
  }

  /** The path a marker holds, or `undefined` when it is not the base64url the writer writes for a path. */
  private static decoded(encoded: string): string | undefined {
    const bytes = Buffer.from(encoded, "base64url");

    if (bytes.length === 0 || bytes.toString("base64url") !== encoded) return undefined;

    try {
      return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      return undefined;
    }
  }
}

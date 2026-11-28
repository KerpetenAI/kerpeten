import { GitDiff } from "../../capability/git/GitDiff.ts";
import type { LineRange } from "./types/comment.ts";

/**
 * The lines of a patch a line comment can sit on: for every file, the line ranges of its hunks on the new side,
 * changed lines and context lines alike. A file is known by the path the patch gives it, so a renamed file by its new
 * path. A deleted file has no new side, and a file that was only renamed or whose mode changed has no hunk: neither
 * has a line. A patch that is not whole is refused.
 */
export class CommentableLines {
  private static readonly HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  private readonly hunks: ReadonlyMap<string, readonly LineRange[]>;

  private constructor(hunks: ReadonlyMap<string, readonly LineRange[]>) {
    this.hunks = hunks;
  }

  public static of(patch: string): CommentableLines {
    const hunks = new Map<string, LineRange[]>();

    for (const section of GitDiff.sections(patch)) {
      const ranges = CommentableLines.ranges(section.text);

      if (ranges.length > 0) hunks.set(section.path, [...(hunks.get(section.path) ?? []), ...ranges]);
    }

    return new CommentableLines(hunks);
  }

  /** Whether the whole range from `start` to `end` lies inside one hunk of `file`. */
  public holds(file: string, start: number, end: number): boolean {
    if (start > end) return false;

    return (this.hunks.get(file) ?? []).some((hunk) => hunk.start <= start && end <= hunk.end);
  }

  private static ranges(section: string): LineRange[] {
    const ranges: LineRange[] = [];
    let oldLeft = 0;
    let newLeft = 0;
    const lines = section.split("\n");

    if (lines.at(-1) === "") lines.pop();

    for (const line of lines) {
      if (oldLeft > 0 || newLeft > 0) {
        const tag = line.charAt(0);

        if (tag === "+") newLeft--;
        else if (tag === "-") oldLeft--;
        else if (tag === " ") {
          oldLeft--;
          newLeft--;
        } else if (tag !== "\\") throw new Error(`unexpected line inside a hunk: ${JSON.stringify(line.slice(0, 80))}`);

        if (oldLeft < 0 || newLeft < 0) throw new Error("hunk is longer than its header says");

        continue;
      }

      if (!line.startsWith("@@ ")) continue;

      const match = CommentableLines.HUNK.exec(line);

      if (match === null) throw new Error(`malformed hunk header ${line}`);

      const start = Number(match[2]);

      oldLeft = match[1] === undefined ? 1 : Number(match[1]);
      newLeft = match[3] === undefined ? 1 : Number(match[3]);

      if (newLeft > 0) ranges.push({ start, end: start + newLeft - 1 });
    }

    if (oldLeft > 0 || newLeft > 0) throw new Error("diff ended inside a hunk");

    return ranges;
  }
}

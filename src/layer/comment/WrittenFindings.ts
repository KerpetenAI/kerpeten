import type { FindingPlace, WrittenComment } from "./types/comment.ts";

/**
 * Says whether a finding is already written on the merge request. It is: when a line comment of Kerpeten there has a
 * marker with the same commit, the same file and the same first and last line. A finding that an earlier summary
 * comment lists is not, because the one summary comment is written anew on every run. This class is the one place
 * that decides it.
 */
export class WrittenFindings {
  private readonly keys: ReadonlySet<string>;

  public constructor(written: readonly WrittenComment[]) {
    this.keys = new Set(
      written.flatMap(({ kind, mark }) =>
        kind === "line" && mark.kind === "finding"
          ? [WrittenFindings.key(mark.headSha, mark.file, mark.startLine, mark.endLine)]
          : [],
      ),
    );
  }

  public has(headSha: string, finding: FindingPlace): boolean {
    return this.keys.has(WrittenFindings.key(headSha, finding.file, finding.start_line, finding.end_line));
  }

  private static key(headSha: string, file: string, startLine: number, endLine: number): string {
    return JSON.stringify([headSha, file, startLine, endLine]);
  }
}

import { RunService, RunValue, Use } from "@kerpetensh/harness-kit";
import { Git } from "../../capability/git/Git.ts";
import { HeadCommit } from "../../capability/git/HeadCommit.ts";
import { RepoLimits } from "../../capability/repo/RepoLimits.ts";
import type { Logger } from "../../log/Logger.ts";
import { LineSplitter } from "../../text/LineSplitter.ts";
import type {
  CandidateCheck,
  CandidateFile,
  CandidateLines,
  DropReason,
  FilteredCandidates,
  ReviewerFinding,
} from "./types/review.ts";

/**
 * Keeps the reviewer's findings that point at real lines of the files at the run's HEAD. It reads each file once per
 * run and logs every finding it drops to the run's log.
 */
@RunService("kerpeten:candidate-filter")
export class CandidateFilter {
  public static readonly MAX_FINDING_LINES = 50;

  @Use(Git)
  private readonly git!: Git;

  @Use(HeadCommit)
  private readonly head!: HeadCommit;

  @RunValue("log")
  private readonly log!: Logger;

  private readonly files = new Map<string, CandidateFile>();
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  public static normalizePath(raw: string): string | undefined {
    let path = raw.replaceAll("\\", "/");

    while (path.startsWith("./")) path = path.slice(2);

    path = path.replace(/\/{2,}/g, "/");

    if (path === "" || path.startsWith("/") || path.endsWith("/") || /[\0\n\r]/.test(path)) return undefined;
    if (path.split("/").some((part) => part === "." || part === "..")) return undefined;

    return path;
  }

  public static check<F extends CandidateLines>(finding: F, lines: CandidateFile): CandidateCheck<F> {
    if (lines === "missing") return { kind: "drop", reason: "no_file" };
    if (lines === "unreadable") return { kind: "drop", reason: "unreadable_file" };

    const { start_line: start, end_line: end } = finding;

    if (end < start) return { kind: "drop", reason: "bad_range" };
    if (end > lines.length) return { kind: "drop", reason: "line_outside" };

    const last = Math.min(end, start + CandidateFilter.MAX_FINDING_LINES - 1);

    if (lines.slice(start - 1, last).every((line) => line.trim() === ""))
      return { kind: "drop", reason: "blank_range" };

    return { kind: "keep", finding: last === end ? finding : { ...finding, end_line: last }, clipped: last !== end };
  }

  public async filter(findings: readonly ReviewerFinding[]): Promise<FilteredCandidates> {
    const kept: ReviewerFinding[] = [];
    const dropped: Partial<Record<DropReason, number>> = {};
    let clipped = 0;

    for (const finding of findings) {
      const path = CandidateFilter.normalizePath(finding.file);
      let reason: DropReason | undefined;

      if (path === undefined) {
        reason = "bad_path";
      } else {
        const check = CandidateFilter.check({ ...finding, file: path }, await this.lines(path));

        if (check.kind === "keep") {
          kept.push(check.finding);

          if (check.clipped) clipped++;
        } else {
          reason = check.reason;
        }
      }

      if (reason !== undefined) {
        dropped[reason] = (dropped[reason] ?? 0) + 1;

        this.log.info("candidate finding dropped", {
          reason,
          file: finding.file,
          start: finding.start_line,
          end: finding.end_line,
        });
      }
    }

    return { kept, dropped, clipped };
  }

  private async lines(path: string): Promise<CandidateFile> {
    const cached = this.files.get(path);

    if (cached !== undefined) return cached;

    const blob = await this.git.readBlob(this.head.sha, path, RepoLimits.MAX_FILE_BYTES);
    let lines: CandidateFile = blob.kind === "missing" ? "missing" : "unreadable";

    if (blob.kind === "blob") {
      try {
        lines = LineSplitter.split(this.decoder.decode(blob.bytes));
      } catch {
        lines = "unreadable";
      }
    }

    this.files.set(path, lines);

    return lines;
  }
}

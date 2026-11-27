import { RepoLimits } from "../../capability/repo/RepoLimits.ts";
import { RipgrepSearch } from "../../capability/repo/RipgrepSearch.ts";
import { regularFile } from "../../files/files-utils.ts";
import { Tool, ToolError, Use } from "../../harness-kit/index.ts";
import { firstLine } from "../../text/text-utils.ts";
import { RepoTool } from "../RepoTool.ts";
import { truncationNotice } from "../tools-utils.ts";
import { GrepRows } from "./GrepRows.ts";
import { grepInput } from "./schemas/grep-schema.ts";
import type { GrepInput, GrepMatch } from "./types/grep.ts";

@Tool({
  name: "grep",
  description: `Search repository files with a regular expression (ripgrep syntax) or a fixed string. path is a file or a directory; leave it out or write "." for the repository root, an empty string is refused. Matches come in path order. At most ${RepoLimits.GREP_MAX_MATCHES} matches; a line longer than ${RepoLimits.GREP_MAX_LINE_CHARS} characters is cut and marked. Binary files and files over ${RepoLimits.MAX_FILE_BYTES / 1024 / 1024} MB are skipped.`,
  input: grepInput,
})
export class GrepTool extends RepoTool {
  private static readonly INVALID_PATTERN = /regex parse error|error parsing regex/;

  private static readonly MAX_ERROR_CHARS = 1000;

  @Use(RipgrepSearch)
  private readonly ripgrep!: RipgrepSearch;

  private static truncated(found: readonly GrepMatch[]): unknown {
    const matches = found.slice(0, RepoLimits.GREP_MAX_MATCHES);

    return { matches, truncated: true, notice: truncationNotice(matches.length) };
  }

  private static grepResult(matches: readonly GrepMatch[], exitCode: number, message: string): unknown {
    if (exitCode === 0 || exitCode === 1) return { matches, truncated: false };

    if (exitCode === 2 && GrepTool.INVALID_PATTERN.test(message)) {
      throw new ToolError(`invalid regex pattern: ${message.slice(0, GrepTool.MAX_ERROR_CHARS)}`);
    }

    const reason = firstLine(message) ?? `exit ${exitCode}`;

    if (exitCode !== 2 && matches.length === 0) throw new ToolError(`grep failed: ${reason}`);

    return {
      matches,
      truncated: false,
      warning: `ripgrep reported an error, results may be incomplete: ${reason}`,
    };
  }

  public async execute(args: GrepInput): Promise<unknown> {
    if (args.pattern.includes("\0")) throw new ToolError("pattern must not contain NUL");

    const target = this.resolve(args.path ?? ".");

    if (this.jail.trackedFile(target.relative)) {
      const stat = regularFile(target.absolute);

      if (stat === undefined || stat.size > RepoLimits.MAX_FILE_BYTES) return { matches: [], truncated: false };
    }

    const rows = new GrepRows(this.jail);

    const query = {
      pattern: args.pattern,
      target: target.relative,
      caseInsensitive: args.case_insensitive === true,
      fixedStrings: args.fixed_strings === true,
    };

    const outcome = await this.ripgrep.search(query, (chunk) => {
      rows.push(chunk);

      return !rows.full;
    });

    switch (outcome.kind) {
      case "not_started":
        throw new ToolError(`ripgrep could not be started: ${outcome.error}`);
      case "timed_out":
        throw new ToolError(`grep timed out after ${outcome.timeoutMs} ms`);
      case "stopped":
        return GrepTool.truncated(rows.matches);
      case "exited":
        rows.end();

        if (rows.full) return GrepTool.truncated(rows.matches);

        return GrepTool.grepResult(rows.matches, outcome.exitCode, outcome.stderr);
    }
  }
}

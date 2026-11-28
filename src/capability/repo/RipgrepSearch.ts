import { Capability, ProcessCapability, type ProcessSettings, RunValue, Use } from "@kerpetensh/harness-kit";
import { RepoJail } from "./RepoJail.ts";
import { RepoLimits } from "./RepoLimits.ts";
import { SearchTimer } from "./SearchTimer.ts";
import type { RipgrepOutcome, RipgrepQuery } from "./types/repo.ts";

@Capability({
  name: "ripgrep",
  description:
    "Searches the repository with ripgrep inside the jail, under a time limit and with only PATH in its environment.",
  permission: "repo:search",
  scope: "run",
})
export class RipgrepSearch extends ProcessCapability {
  public static readonly COMMAND = "rg";

  /** The PATH ripgrep is searched on when the environment has none. */
  public static readonly FALLBACK_PATH = "/usr/bin:/bin";

  @Use(RepoJail)
  private readonly jail!: RepoJail;

  @Use(SearchTimer)
  private readonly timer!: SearchTimer;

  @RunValue("pathEnv")
  private readonly pathEnv!: string;

  /** Whether ripgrep is found on `pathEnv`, the PATH a review gives it; nothing is run. */
  public static onPath(pathEnv: string): boolean {
    return Bun.which(RipgrepSearch.COMMAND, { PATH: pathEnv }) !== null;
  }

  private static rgArgs(query: RipgrepQuery): string[] {
    return [
      "--no-config",
      "--no-messages",
      "--color=never",
      "--no-heading",
      "--with-filename",
      "--line-number",
      "--null",
      "--hidden",
      "--no-ignore",
      `--max-filesize=${RepoLimits.MAX_FILE_BYTES}`,
      `--max-columns=${RepoLimits.GREP_MAX_LINE_CHARS}`,
      "--max-columns-preview",
      `--max-count=${RepoLimits.GREP_MAX_MATCHES + 1}`,
      "--sort=path",
      ...(query.caseInsensitive ? ["--ignore-case"] : []),
      ...(query.fixedStrings ? ["--fixed-strings"] : []),
      "--iglob=!.git",
      "--",
      query.pattern,
      query.target,
    ];
  }

  public async search(query: RipgrepQuery, take: (chunk: Uint8Array) => boolean): Promise<RipgrepOutcome> {
    const outcome = await this.stream(RipgrepSearch.rgArgs(query), take, this.timer.timeoutMs);

    if (outcome.kind !== "exited") return outcome;

    return { ...outcome, stderr: outcome.exitCode === 0 || outcome.exitCode === 1 ? "" : outcome.stderr.trim() };
  }

  protected processSettings(): ProcessSettings {
    return { command: RipgrepSearch.COMMAND, fixedArgs: [], cwd: this.jail.root, env: { PATH: this.pathEnv } };
  }
}

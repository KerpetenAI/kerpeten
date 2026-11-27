import { Capability, ProcessCapability, type ProcessSettings, RunValue, Use } from "../../harness-kit/index.ts";
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
  @Use(RepoJail)
  private readonly jail!: RepoJail;

  @Use(SearchTimer)
  private readonly timer!: SearchTimer;

  @RunValue("pathEnv")
  private readonly pathEnv!: string;

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
    return { command: "rg", fixedArgs: [], cwd: this.jail.root, env: { PATH: this.pathEnv } };
  }
}

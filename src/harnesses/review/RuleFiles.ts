import { RunService, Use } from "@kerpetensh/harness-kit";
import { Git } from "../../capability/git/Git.ts";
import { HeadCommit } from "../../capability/git/HeadCommit.ts";
import { RepoJail } from "../../capability/repo/RepoJail.ts";
import { RepoLimits } from "../../capability/repo/RepoLimits.ts";
import type { RuleFile, RuleFileSet, RuleFileText, SkippedRuleFile } from "./types/review.ts";

/**
 * Reads the project's rule files, `AGENTS.md` and `CLAUDE.md` in the repository root, as the tools see them: a file
 * only when it is tracked at the run's HEAD, and a link only when it ends at a tracked file inside the repository. The
 * text is the one at HEAD. Rule files with the same text come back as one file that names the others.
 */
@RunService("kerpeten:rule-files")
export class RuleFiles {
  public static readonly NAMES: readonly string[] = ["AGENTS.md", "CLAUDE.md"];

  @Use(RepoJail)
  private readonly jail!: RepoJail;

  @Use(Git)
  private readonly git!: Git;

  @Use(HeadCommit)
  private readonly head!: HeadCommit;

  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  public async read(): Promise<RuleFileSet> {
    const files: RuleFile[] = [];
    const skipped: SkippedRuleFile[] = [];

    for (const name of RuleFiles.NAMES) {
      if (!this.jail.trackedFile(name)) continue;

      const read = await this.text(name);

      if (!read.ok) {
        skipped.push({ name, reason: read.reason });

        continue;
      }

      const index = files.findIndex((file) => file.text === read.text);
      const same = files[index];

      if (same === undefined) files.push({ name, sameText: [], text: read.text });
      else files[index] = { ...same, sameText: [...same.sameText, name] };
    }

    return { files, skipped };
  }

  private async text(name: string): Promise<RuleFileText> {
    const resolved = this.jail.resolve(name);

    if (!resolved.ok) return { ok: false, reason: resolved.error };

    const blob = await this.git.readBlob(this.head.sha, resolved.relative, RepoLimits.MAX_FILE_BYTES);

    if (blob.kind === "missing") return { ok: false, reason: "not a file at HEAD" };
    if (blob.kind === "too_large") return { ok: false, reason: `larger than ${RepoLimits.MAX_FILE_BYTES} bytes` };

    try {
      return { ok: true, text: this.decoder.decode(blob.bytes) };
    } catch {
      return { ok: false, reason: "not UTF-8 text" };
    }
  }
}

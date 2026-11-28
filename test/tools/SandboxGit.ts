import { Capability, RunValue } from "@kerpetensh/harness-kit";
import { Git } from "../../src/capability/git/Git.ts";

/** Git over a sandbox that is not a git repository: the files tracked at any commit are the run's value `tracked`. */
@Capability({
  name: "git",
  description: "Git of a test sandbox, which lists the tracked files of the run's values.",
  scope: "run",
})
export class SandboxGit extends Git {
  @RunValue("tracked")
  private readonly listed!: readonly string[];

  public override trackedFiles(): Promise<string[]> {
    return Promise.resolve([...this.listed].sort());
  }
}

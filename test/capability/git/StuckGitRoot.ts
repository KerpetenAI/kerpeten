import { join } from "node:path";
import { Capability, type ProcessSettings } from "@kerpetensh/harness-kit";
import { GitRoot } from "../../../src/capability/git/GitRoot.ts";

/**
 * A git root whose git is the program named `git` in the working directory and gets a fifth of a second, so a test
 * can put a script that never ends there and see the time limit.
 */
@Capability({
  name: "git-root",
  description: "The git root of a test, with the git of the working directory and a short time limit.",
})
export class StuckGitRoot extends GitRoot {
  public static readonly SHORT_MS = 200;

  protected override readMs(): number {
    return StuckGitRoot.SHORT_MS;
  }

  protected override processSettings(): ProcessSettings {
    const settings = super.processSettings();

    return { ...settings, command: join(settings.cwd, "git") };
  }
}

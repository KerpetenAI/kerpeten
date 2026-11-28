import { join } from "node:path";
import { Capability, type ProcessSettings } from "@kerpetensh/harness-kit";
import { Git } from "../../../src/capability/git/Git.ts";

/**
 * A git whose program is the file `stuck-git` in the repository and gets a fifth of a second, so a test can put a
 * script that never ends there and see the time limit.
 */
@Capability({
  name: "git",
  description: "The git of a test, with the program stuck-git of the repository and a short time limit.",
  scope: "run",
})
export class StuckGit extends Git {
  public static readonly PROGRAM = "stuck-git";

  public static readonly SHORT_MS = 200;

  protected override readMs(): number {
    return StuckGit.SHORT_MS;
  }

  protected override processSettings(): ProcessSettings {
    const settings = super.processSettings();

    return { ...settings, command: join(settings.cwd, StuckGit.PROGRAM) };
  }
}

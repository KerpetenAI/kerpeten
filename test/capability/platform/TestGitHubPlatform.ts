import { Capability, type ProcessSettings, RunValue } from "@kerpetensh/harness-kit";
import { GitHubPlatform } from "../../../src/capability/platform/GitHubPlatform.ts";
import type { PlatformReadLimits } from "../../../src/capability/platform/types/platform.ts";

/**
 * The GitHub platform whose command and read budget the run's values give, so a test can put a script in the place of
 * gh and reach a limit with a small answer.
 */
@Capability({
  name: "github-platform",
  description: "The GitHub platform with the command of the test run.",
  scope: "run",
})
export class TestGitHubPlatform extends GitHubPlatform {
  @RunValue("ghCommand")
  private readonly ghCommand!: string;

  @RunValue("ghLimits")
  private readonly ghLimits!: PlatformReadLimits;

  protected override readLimits(): PlatformReadLimits {
    return this.ghLimits;
  }

  protected override processSettings(): ProcessSettings {
    return { ...super.processSettings(), command: this.ghCommand };
  }
}

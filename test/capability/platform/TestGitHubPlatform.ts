import { GitHubPlatform } from "../../../src/capability/platform/GitHubPlatform.ts";
import { Capability, type ProcessSettings, RunValue } from "../../../src/harness-kit/index.ts";

/** The GitHub platform whose command the run's values give, so a test can put a script in the place of gh. */
@Capability({
  name: "github-platform",
  description: "The GitHub platform with the command of the test run.",
  scope: "run",
})
export class TestGitHubPlatform extends GitHubPlatform {
  @RunValue("ghCommand")
  private readonly ghCommand!: string;

  protected override processSettings(): ProcessSettings {
    return { ...super.processSettings(), command: this.ghCommand };
  }
}

import { GitLabPlatform } from "../../../src/capability/platform/GitLabPlatform.ts";
import { Capability, type ProcessSettings, RunValue } from "../../../src/harness-kit/index.ts";

/** The GitLab platform whose command the run's values give, so a test can put a script in the place of glab. */
@Capability({
  name: "gitlab-platform",
  description: "The GitLab platform with the command of the test run.",
  scope: "run",
})
export class TestGitLabPlatform extends GitLabPlatform {
  @RunValue("glabCommand")
  private readonly glabCommand!: string;

  protected override processSettings(): ProcessSettings {
    return { ...super.processSettings(), command: this.glabCommand };
  }
}

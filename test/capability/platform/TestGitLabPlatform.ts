import { Capability, type ProcessSettings, RunValue } from "@kerpetensh/harness-kit";
import { GitLabPlatform } from "../../../src/capability/platform/GitLabPlatform.ts";
import type { PlatformReadLimits } from "../../../src/capability/platform/types/platform.ts";

/**
 * The GitLab platform whose command and read budget the run's values give, so a test can put a script in the place of
 * glab and reach a limit with a small answer.
 */
@Capability({
  name: "gitlab-platform",
  description: "The GitLab platform with the command of the test run.",
  scope: "run",
})
export class TestGitLabPlatform extends GitLabPlatform {
  @RunValue("glabCommand")
  private readonly glabCommand!: string;

  @RunValue("glabLimits")
  private readonly glabLimits!: PlatformReadLimits;

  protected override readLimits(): PlatformReadLimits {
    return this.glabLimits;
  }

  protected override processSettings(): ProcessSettings {
    return { ...super.processSettings(), command: this.glabCommand };
  }
}

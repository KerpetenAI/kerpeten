import { RipgrepSearch } from "../../src/capability/repo/RipgrepSearch.ts";
import { Capability, type ProcessSettings, RunValue } from "../../src/harness-kit/index.ts";

/** Ripgrep whose command the run's values give, so a test can put a script in its place. */
@Capability({
  name: "ripgrep",
  description: "Ripgrep with the command of the test run.",
  permission: "repo:search",
  scope: "run",
})
export class TestRipgrep extends RipgrepSearch {
  public static built = 0;

  @RunValue("rgCommand")
  private readonly rgCommand!: string;

  public constructor() {
    super();
    TestRipgrep.built++;
  }

  protected override processSettings(): ProcessSettings {
    return { ...super.processSettings(), command: this.rgCommand };
  }
}

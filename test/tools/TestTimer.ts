import { RepoLimits } from "../../src/capability/repo/RepoLimits.ts";
import { SearchTimer } from "../../src/capability/repo/SearchTimer.ts";
import { Capability } from "../../src/harness-kit/index.ts";

/** The search timer of a test: the time limit and the clock the test set last, the production ones until it sets any. */
@Capability({
  name: "search-timer",
  description: "The search timer of a test, with the time limit and the clock the test sets.",
  permission: "repo:read",
})
export class TestTimer extends SearchTimer {
  private limit = RepoLimits.SEARCH_TIMEOUT_MS;

  private clock: () => number = () => performance.now();

  public override get timeoutMs(): number {
    return this.limit;
  }

  public override now(): number {
    return this.clock();
  }

  public set(limit: number, clock: () => number): void {
    this.limit = limit;
    this.clock = clock;
  }
}

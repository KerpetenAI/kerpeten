import { Capability, CapabilityBase } from "../../harness-kit/index.ts";
import { RepoLimits } from "./RepoLimits.ts";

/**
 * The time limit of a search through the repository and the clock that measures it. It declares `repo:read`, the
 * permission of the jail every search goes through, since a tool takes only capabilities that declare a permission.
 */
@Capability({
  name: "search-timer",
  description: "Gives a search through the repository its time limit and the clock that measures it.",
  permission: "repo:read",
})
export class SearchTimer extends CapabilityBase {
  public get timeoutMs(): number {
    return RepoLimits.SEARCH_TIMEOUT_MS;
  }

  /** The time of the clock in milliseconds, from an arbitrary start. */
  public now(): number {
    return performance.now();
  }
}

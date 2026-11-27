import { HeadCommit } from "../../src/capability/git/HeadCommit.ts";

/** A HEAD for a sandbox that is not a git repository; the sandbox's git lists the same tracked files at any commit. */
export class PinnedHead extends HeadCommit {
  public override get sha(): string {
    return "0".repeat(40);
  }
}

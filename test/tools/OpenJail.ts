import { join } from "node:path";
import { Capability } from "@kerpetensh/harness-kit";
import { RepoJail } from "../../src/capability/repo/RepoJail.ts";
import type { JailResult } from "../../src/capability/repo/types/repo.ts";

/** A jail that lets every path through, so a test can see what ripgrep keeps out on its own. */
@Capability({
  name: "repo-jail",
  description: "A repository jail that lets every path through.",
  permission: "repo:read",
  scope: "run",
})
export class OpenJail extends RepoJail {
  public override trackedFile(path: string): boolean {
    return path !== ".";
  }

  public override regularTrackedFile(): boolean {
    return true;
  }

  public override resolve(path: string): JailResult {
    return { ok: true, absolute: join(this.root, path), relative: path };
  }
}

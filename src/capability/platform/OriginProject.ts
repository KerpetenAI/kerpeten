import { RunService, Use } from "../../harness-kit/index.ts";
import { Git } from "../git/Git.ts";
import { PlatformError } from "./PlatformError.ts";
import { RemoteProject } from "./RemoteProject.ts";

/**
 * The project of the run's repository on its platform: the one the `origin` remote names, read once per run. A review
 * of a merge request is of that project and of no other; the platform's command line tool is told the host and the
 * project and chooses neither. A repository without an `origin` remote, and an `origin` that names no project, is a
 * `PlatformError`.
 */
@RunService("kerpeten:origin-project")
export class OriginProject {
  @Use(Git)
  private readonly git!: Git;

  private read: Promise<RemoteProject> | undefined;

  /** The project of the `origin` remote. Every call of a run gives the same answer, or the same error. */
  public project(): Promise<RemoteProject> {
    this.read ??= this.find();

    return this.read;
  }

  private async find(): Promise<RemoteProject> {
    const url = await this.git.originUrl();

    if (url === undefined) {
      throw new PlatformError(
        "no_repository",
        "this repository has no origin remote: a review of a pull request or merge request reads it from the project of the origin remote, so add one with `git remote add origin <address of the project>`",
      );
    }

    return RemoteProject.parse(url);
  }
}

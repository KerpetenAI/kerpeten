import { OnStart } from "@asenajs/ioc";
import { RunService, Use } from "../../harness-kit/index.ts";
import { Git } from "./Git.ts";

/**
 * The commit HEAD pointed at when the run first needed it, resolved once per run, so every part of the run reads the
 * same commit: the change, the files the tools may read and the lines the findings are checked against.
 */
@RunService("kerpeten:head-commit")
export class HeadCommit {
  @Use(Git)
  private readonly git!: Git;

  private pinned: string | undefined;

  public get sha(): string {
    if (this.pinned === undefined) throw new Error("HEAD is read before the run pinned it");

    return this.pinned;
  }

  @OnStart()
  public async pin(): Promise<void> {
    this.pinned = await this.git.resolveCommit("HEAD");
  }
}

import { Inject } from "@asenajs/ioc";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { Capability, ProcessCapability, type ProcessSettings } from "../../harness-kit/index.ts";
import { Git } from "./Git.ts";

/** Finds the repository around the working directory before any run exists, with the same git options as `Git`. */
@Capability({
  name: "git-root",
  description: "Runs git in the working directory to find the top of the repository around it.",
})
export class GitRoot extends ProcessCapability {
  @Inject(Names.CWD)
  private readonly cwd!: Instances[Names.CWD];

  public async root(): Promise<string> {
    const result = await this.collect(["rev-parse", "--show-toplevel"]);

    if (result.exitCode !== 0) throw new Error(`${this.cwd} is not inside a git work tree`);

    return result.stdout.toString("utf8").replace(/\n$/, "");
  }

  protected processSettings(): ProcessSettings {
    return { command: "git", fixedArgs: Git.FIXED_OPTIONS, cwd: this.cwd, env: "inherit" };
  }
}

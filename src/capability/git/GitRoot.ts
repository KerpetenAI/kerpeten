import { Inject } from "@asenajs/ioc";
import {
  Capability,
  ProcessCapability,
  type ProcessResult,
  type ProcessSettings,
  ProcessTimeoutError,
} from "@kerpetensh/harness-kit";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { Git } from "./Git.ts";
import { GitTimeoutError } from "./GitTimeoutError.ts";

/** Finds the repository around the working directory before any run exists, with the same git options as `Git`. */
@Capability({
  name: "git-root",
  description: "Runs git in the working directory to find the top of the repository around it.",
})
export class GitRoot extends ProcessCapability {
  @Inject(Names.CWD)
  private readonly cwd!: Instances[Names.CWD];

  /** The time the git command gets; a test gives a shorter one. */
  protected readMs(): number {
    return Git.READ_MS;
  }

  /**
   * The top of the repository around the working directory. Outside a git work tree it throws; a git that does not
   * finish within `readMs` is stopped and a `GitTimeoutError` is thrown.
   */
  public async root(): Promise<string> {
    const args = ["rev-parse", "--show-toplevel"];
    const ms = this.readMs();
    let result: ProcessResult;

    try {
      result = await this.collect(args, ms);
    } catch (error) {
      if (error instanceof ProcessTimeoutError) throw new GitTimeoutError(args, ms);

      throw error;
    }

    if (result.exitCode !== 0) throw new Error(`${this.cwd} is not inside a git work tree`);

    return result.stdout.toString("utf8").replace(/\n$/, "");
  }

  protected processSettings(): ProcessSettings {
    return { command: "git", fixedArgs: Git.FIXED_OPTIONS, cwd: this.cwd, env: "inherit" };
  }
}

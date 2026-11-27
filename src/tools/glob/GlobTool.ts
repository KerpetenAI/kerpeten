import { RepoJail } from "../../capability/repo/RepoJail.ts";
import { SearchTimer } from "../../capability/repo/SearchTimer.ts";
import { Tool, ToolError, Use } from "../../harness-kit/index.ts";
import { RepoTool } from "../RepoTool.ts";
import { ToolLimits } from "../ToolLimits.ts";
import { truncationNotice } from "../tools-utils.ts";
import { globInput } from "./schemas/glob-schema.ts";
import type { GlobInput } from "./types/glob.ts";

@Tool({
  name: "glob",
  description: `Find repository files whose path matches a glob pattern such as src/**/*.ts. The pattern is matched relative to path (a directory; leave it out or write "." for the repository root, an empty string is refused), and the results are relative to the repository root. At most ${ToolLimits.GLOB_MAX_RESULTS} results.`,
  input: globInput,
})
export class GlobTool extends RepoTool {
  @Use(SearchTimer)
  private readonly timer!: SearchTimer;

  private static unsafePattern(pattern: string): boolean {
    if (pattern.includes("\0") || RepoJail.absolutePath(pattern) || RepoJail.touchesGit(pattern)) return true;

    return pattern.split(/[\\/]/).some((part) => part === "..");
  }

  public execute(args: GlobInput): unknown {
    const pattern = args.pattern.replace(/^(\.\/)+/, "");

    if (pattern === "") throw new ToolError("pattern must name files, not only ./");

    if (GlobTool.unsafePattern(pattern))
      throw new ToolError("pattern must be relative and must not contain .. or .git");

    const base = this.directory(args.path ?? ".");

    const glob = new Bun.Glob(pattern);
    const scope = base.relative === "." ? "" : `${base.relative}/`;
    const { timer } = this;
    const started = timer.now();
    const files: string[] = [];

    for (const file of this.jail.files) {
      if (timer.now() - started >= timer.timeoutMs) throw new ToolError(`glob timed out after ${timer.timeoutMs} ms`);

      if (!file.startsWith(scope) || !glob.match(file.slice(scope.length)) || !this.jail.regularTrackedFile(file))
        continue;

      if (files.length >= ToolLimits.GLOB_MAX_RESULTS)
        return { files, truncated: true, notice: truncationNotice(files.length) };

      files.push(file);
    }

    return { files, truncated: false };
  }
}

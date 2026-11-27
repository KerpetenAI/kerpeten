import { lstatSync } from "node:fs";
import { RepoJail } from "../capability/repo/RepoJail.ts";
import { RepoLimits } from "../capability/repo/RepoLimits.ts";
import { regularFile } from "../files/files-utils.ts";
import { ToolError, Use } from "../harness-kit/index.ts";
import type { ResolvedPath } from "./types/tools.ts";

export abstract class RepoTool {
  @Use(RepoJail)
  protected readonly jail!: RepoJail;

  protected resolve(path: string): ResolvedPath {
    const resolved = this.jail.resolve(path);

    if (!resolved.ok) throw new ToolError(resolved.error);

    return resolved;
  }

  protected directory(path: string): ResolvedPath {
    const resolved = this.resolve(path);

    if (!lstatSync(resolved.absolute).isDirectory()) throw new ToolError("not a directory");

    return resolved;
  }

  protected file(path: string): ResolvedPath {
    const resolved = this.resolve(path);
    const stat = regularFile(resolved.absolute);

    if (stat === undefined) throw new ToolError("not a regular file");
    if (stat.size > RepoLimits.MAX_FILE_BYTES) throw new ToolError("file is too large to read");

    return resolved;
  }
}

import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Tool } from "../../harness-kit/index.ts";
import { RepoTool } from "../RepoTool.ts";
import { ToolLimits } from "../ToolLimits.ts";
import { listDirInput } from "./schemas/list-dir-schema.ts";
import type { EntryType, ListDirInput } from "./types/list-dir.ts";

@Tool({
  name: "list_dir",
  description: `List the entries of a repository directory; leave path out or write "." for the root, an empty string is refused. At most ${ToolLimits.LIST_DIR_MAX_ENTRIES} entries.`,
  input: listDirInput,
})
export class ListDirTool extends RepoTool {
  public execute(args: ListDirInput): unknown {
    const resolved = this.directory(args.path ?? ".");

    const names = readdirSync(resolved.absolute)
      .filter((name) => name.toLowerCase() !== ".git")
      .filter((name) => this.jail.tracked(resolved.relative === "." ? name : `${resolved.relative}/${name}`))
      .sort();

    const entries = names.slice(0, ToolLimits.LIST_DIR_MAX_ENTRIES).map((name) => {
      const stat = lstatSync(join(resolved.absolute, name));

      const type: EntryType = stat.isSymbolicLink()
        ? "symlink"
        : stat.isDirectory()
          ? "dir"
          : stat.isFile()
            ? "file"
            : "other";

      return { name, type };
    });

    return { path: resolved.relative, entries, truncated: names.length > ToolLimits.LIST_DIR_MAX_ENTRIES };
  }
}

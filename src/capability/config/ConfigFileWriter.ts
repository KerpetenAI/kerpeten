import { closeSync, fsyncSync, openSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exists } from "../../files/files-utils.ts";
import type { ErrnoLike } from "../../files/types/files.ts";
import { Capability, CapabilityBase } from "../../harness-kit/index.ts";
import { ConfigLoader } from "./ConfigLoader.ts";

/**
 * Creates `.kerpeten.yml` in the root of a repository for `kerpeten init`, and nothing else. It never overwrites: the
 * file is created exclusively, so an existing file or a link at that path, even one that points nowhere, is an error.
 */
@Capability({
  name: "config-file-writer",
  description:
    "Creates .kerpeten.yml in the repository root for kerpeten init; it never overwrites a file and never follows a link at that path.",
  permission: "config:write",
})
export class ConfigFileWriter extends CapabilityBase {
  private static readonly FILE_MODE = 0o644;

  public static path(root: string): string {
    return join(root, ConfigLoader.CONFIG_FILE);
  }

  public static existsMessage(path: string): string {
    return `${path} already exists; init does not change it. Edit it by hand, or remove it and run \`kerpeten init\` again`;
  }

  /** Whether something, a file, a directory or a link, is at the path of `.kerpeten.yml` in `root`. */
  public taken(root: string): boolean {
    return exists(ConfigFileWriter.path(root));
  }

  /** Creates `.kerpeten.yml` in `root` with `text` and returns its path; a file that cannot be written whole is removed. */
  public create(root: string, text: string): string {
    const path = ConfigFileWriter.path(root);
    let fd: number;

    try {
      fd = openSync(path, "wx", ConfigFileWriter.FILE_MODE);
    } catch (error) {
      if ((error as ErrnoLike | null)?.code === "EEXIST") throw new Error(ConfigFileWriter.existsMessage(path));

      throw error;
    }

    try {
      writeFileSync(fd, text);

      fsyncSync(fd);
    } catch (error) {
      closeSync(fd);
      rmSync(path, { force: true });

      throw error;
    }

    closeSync(fd);

    return path;
  }
}

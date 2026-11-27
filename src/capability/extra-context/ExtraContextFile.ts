import { Inject } from "@asenajs/ioc";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { readText } from "../../files/files-utils.ts";
import { Capability, CapabilityBase } from "../../harness-kit/index.ts";
import { errorMessage } from "../../text/text-utils.ts";
import type { ExtraContextResult } from "./types/extra-context.ts";

/**
 * Reads the extra context the user gives with `--extra-context`: a plain text file anywhere on disk, or stdin for `-`.
 * Text that cannot be read, is not UTF-8, holds a NUL character, is empty or is longer than the limit is an error that
 * names the source and the reason; nothing is cut.
 */
@Capability({
  name: "extra-context-file",
  description:
    "Reads the plain text given with --extra-context, from a file or from stdin, and checks that it is text within the size limit.",
})
export class ExtraContextFile extends CapabilityBase {
  public static readonly STDIN = "-";

  public static readonly MAX_CHARS = 20_000;

  public static readonly MAX_BYTES = 5_000_000;

  @Inject(Names.STDIN)
  private readonly stdin!: Instances[Names.STDIN];

  public static check(source: string, text: string): ExtraContextResult {
    const max = ExtraContextFile.MAX_CHARS;

    if (text.includes("\0")) return { ok: false, error: `${source}: not plain text, it holds a NUL character` };
    if (text.trim() === "") return { ok: false, error: `${source}: empty` };

    if (text.length > max) {
      return { ok: false, error: `${source}: ${text.length} characters, more than the limit of ${max}` };
    }

    return { ok: true, text };
  }

  public async read(source: string): Promise<ExtraContextResult> {
    const read = source === ExtraContextFile.STDIN ? await this.readStdin() : ExtraContextFile.readFile(source);

    return read.ok ? ExtraContextFile.check(source === ExtraContextFile.STDIN ? "stdin" : source, read.text) : read;
  }

  private static readFile(path: string): ExtraContextResult {
    const file = readText(path, ExtraContextFile.MAX_BYTES);

    if (file.ok) return file;

    if (file.reason === "too_large") {
      return {
        ok: false,
        error: `${path}: larger than ${ExtraContextFile.MAX_BYTES} bytes, more than the limit of ${ExtraContextFile.MAX_CHARS} characters`,
      };
    }

    return { ok: false, error: file.error };
  }

  private async readStdin(): Promise<ExtraContextResult> {
    const chunks: Uint8Array[] = [];
    let size = 0;

    try {
      for await (const chunk of this.stdin()) {
        size += chunk.length;

        if (size > ExtraContextFile.MAX_BYTES) {
          return {
            ok: false,
            error: `stdin: larger than ${ExtraContextFile.MAX_BYTES} bytes, more than the limit of ${ExtraContextFile.MAX_CHARS} characters`,
          };
        }

        chunks.push(chunk);
      }
    } catch (error) {
      return { ok: false, error: `stdin: cannot be read (${errorMessage(error)})` };
    }

    try {
      return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)) };
    } catch {
      return { ok: false, error: "stdin: not UTF-8" };
    }
  }
}

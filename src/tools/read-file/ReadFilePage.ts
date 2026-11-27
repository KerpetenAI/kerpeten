import type { SplitLine } from "../../text/types/text.ts";
import { ToolLimits } from "../ToolLimits.ts";
import type { PageTail } from "./types/read-file.ts";

export class ReadFilePage {
  public readonly lines: string[] = [];
  private readonly first: number;
  private readonly last: number;
  private readonly tailLines: string[] = [];
  private bytes = 0;
  private full = false;
  private lineCount = 0;

  public constructor(first: number, last: number) {
    this.first = first;
    this.last = last;
  }

  public get total(): number {
    return this.lineCount;
  }

  public take(line: SplitLine): void {
    this.lineCount += 1;

    const text = line.cut ? `${line.text}${ToolLimits.LINE_CUT_SUFFIX}` : line.text;

    this.tailLines[(this.lineCount - 1) % ToolLimits.READ_FILE_TAIL_LINES] = text;

    if (this.full || this.lineCount < this.first || this.lineCount > this.last) return;

    const entry = `${this.lineCount}\t${text}`;
    const bytes = Buffer.byteLength(entry, "utf8") + (this.lines.length > 0 ? 1 : 0);

    if (this.bytes + bytes > ToolLimits.READ_FILE_MAX_BYTES) {
      this.full = true;

      return;
    }

    this.lines.push(entry);
    this.bytes += bytes;
  }

  public tail(): PageTail {
    const lines: string[] = [];
    let bytes = 0;
    const oldest = Math.max(1, this.lineCount - ToolLimits.READ_FILE_TAIL_LINES + 1);

    for (let n = this.lineCount; n >= oldest; n--) {
      const entry = `${n}\t${this.tailLines[(n - 1) % ToolLimits.READ_FILE_TAIL_LINES] ?? ""}`;

      bytes += Buffer.byteLength(entry, "utf8") + (lines.length > 0 ? 1 : 0);

      if (bytes > ToolLimits.READ_FILE_MAX_BYTES) break;

      lines.unshift(entry);
    }

    return { first: this.lineCount - lines.length + 1, lines };
  }
}

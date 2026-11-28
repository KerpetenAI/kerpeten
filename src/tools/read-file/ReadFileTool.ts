import { Tool, ToolError } from "@kerpetensh/harness-kit";
import { RepoLimits } from "../../capability/repo/RepoLimits.ts";
import { LineSplitter } from "../../text/LineSplitter.ts";
import { RepoTool } from "../RepoTool.ts";
import { ToolLimits } from "../ToolLimits.ts";
import { ReadFilePage } from "./ReadFilePage.ts";
import { readFileInput } from "./schemas/read-file-schema.ts";
import type { ReadFileInput } from "./types/read-file.ts";

@Tool({
  name: "read_file",
  description: `Read a text file of the repository, optionally a line range. Returns numbered lines, at most ${ToolLimits.READ_FILE_MAX_LINES} lines or ${ToolLimits.READ_FILE_MAX_BYTES / 1024} KB per call; when more lines remain, a notice gives the start_line to continue with. A line longer than ${ToolLimits.READ_FILE_MAX_LINE_CHARS} characters is cut and marked. A start_line past the end returns the last lines of the file.`,
  input: readFileInput,
})
export class ReadFileTool extends RepoTool {
  private static readonly BINARY_PROBE_BYTES = 8192;

  public async execute(args: ReadFileInput): Promise<unknown> {
    const resolved = this.file(args.path);

    const start = args.start_line ?? 1;
    const requestedEnd = args.end_line;

    if (requestedEnd !== undefined && requestedEnd < start)
      throw new ToolError("end_line must not be before start_line");

    const page = new ReadFilePage(
      start,
      Math.min(requestedEnd ?? Number.POSITIVE_INFINITY, start + ToolLimits.READ_FILE_MAX_LINES - 1),
    );

    const splitter = new LineSplitter(ToolLimits.READ_FILE_MAX_LINE_CHARS);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let offset = 0;

    try {
      for await (const chunk of Bun.file(resolved.absolute).stream()) {
        if (
          offset < ReadFileTool.BINARY_PROBE_BYTES &&
          chunk.subarray(0, ReadFileTool.BINARY_PROBE_BYTES - offset).includes(0)
        ) {
          throw new ToolError("binary file");
        }

        offset += chunk.length;

        if (offset > RepoLimits.MAX_FILE_BYTES) throw new ToolError("file is too large to read");
        for (const line of splitter.push(decoder.decode(chunk, { stream: true }))) page.take(line);
      }

      for (const line of splitter.push(decoder.decode())) page.take(line);
    } catch (error) {
      if (error instanceof TypeError) throw new ToolError("not a UTF-8 text file");

      throw error;
    }

    for (const line of splitter.end()) page.take(line);

    const total = page.total;

    if (start > Math.max(total, 1)) {
      const tail = page.tail();

      return {
        path: resolved.relative,
        start_line: tail.first,
        end_line: total,
        total_lines: total,
        truncated: false,
        notice: `start_line ${start} is past the end of the file (${total} lines); showing its last ${tail.lines.length} lines.`,
        content: tail.lines.join("\n"),
      };
    }

    const end = start - 1 + page.lines.length;
    const truncated = end < Math.min(requestedEnd ?? total, total);

    return {
      path: resolved.relative,
      start_line: start,
      end_line: end,
      total_lines: total,
      truncated,
      ...(truncated
        ? { notice: `Output truncated. If you need more of this file, continue with start_line ${end + 1}.` }
        : {}),
      content: page.lines.join("\n"),
    };
  }
}

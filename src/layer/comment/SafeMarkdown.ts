import { oneLine } from "../../text/text-utils.ts";
import type { CodeFence } from "./types/comment.ts";

/**
 * Makes text a model wrote safe to stand inside a comment, so that the text after it stays what it is: the fixed text
 * stays readable and the hidden marker stays hidden. It changes as little as it can:
 *
 * - Outside code, a `<` that could start HTML gets a backslash before it. Markdown shows `\<` as `<`, so the text reads
 *   the same, but no tag, no HTML comment and no HTML block can start: an open `<!--` or `<details>` cannot swallow
 *   what follows, and a marker a model wrote is shown as text. A `<` before a space and a plain `<https://...>` link
 *   stay as they are.
 * - Code stays as it is: a fenced code block, and a code span that opens and closes on one line. So `Array<string>` in
 *   backticks and a `<div>` in a code block read as written.
 * - A fenced code block that is left open is closed, so the text after it is not shown as code.
 * - Text for a place inside a line is safe at its two ends, because the program writes its own marks right before and
 *   after it, such as the `**` around a title. A backslash that ends it gets a second one, so it shows as a backslash
 *   and escapes nothing of what follows. A `*` that starts or ends it gets a backslash, so it cannot join the marks
 *   around it, and so does a `#` that ends it, which would be taken for the closing of a heading and not shown.
 *
 * To be sure where code is, it makes the text say so in one way only. A fence that is indented moves to the start of
 * its line, with the lines of its block, so every fence it knows is one of the top level and ends only at its closing
 * fence; whether a line closes a block is decided on the line as it is written out. A backtick that closes no code
 * span on its line gets a backslash, so it cannot open a span that ends on a later line. Code it does not know for
 * sure is treated as text, which is the safe side: in an indented code block a backslash shows, and a fence behind a
 * quote or a list marker on its line is shown as text.
 */
export class SafeMarkdown {
  private static readonly OPENING_FENCE = /^([ \t]*)(`{3,}|~{3,})([\s\S]*)$/;

  private static readonly AUTOLINK = /^<https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+>/;

  private static readonly PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

  private static readonly BACKTICKS = /`+/g;

  private static readonly JOINS_BEFORE = "*";

  private static readonly JOINS_AFTER = "*#";

  /** Text of one or more lines that starts at the start of a line. */
  public static block(text: string): string {
    const lines: string[] = [];
    let fence: CodeFence | undefined;

    for (const line of SafeMarkdown.plain(text).split("\n")) {
      if (fence === undefined) {
        fence = SafeMarkdown.opening(line);
        lines.push(fence === undefined ? SafeMarkdown.inline(line) : line.slice(fence.indent));
      } else {
        const shown = SafeMarkdown.unindented(line, fence.indent);
        const closed = SafeMarkdown.closes(shown, fence);

        lines.push(closed ? shown.trim() : shown);

        if (closed) fence = undefined;
      }
    }

    if (fence !== undefined) lines.push(fence.char.repeat(fence.length));

    return lines.join("\n");
  }

  /**
   * Text for a place inside a line, such as a title: brought to one line, with no code block, and safe at its two
   * ends, so marks written right before and after it keep their meaning.
   */
  public static line(text: string): string {
    return SafeMarkdown.bounded(SafeMarkdown.inline(oneLine(SafeMarkdown.plain(text))));
  }

  /** Text as a code span on one line, whatever backticks it holds. */
  public static code(text: string): string {
    const line = oneLine(SafeMarkdown.plain(text));

    if (line === "") return "";

    const longest = (line.match(SafeMarkdown.BACKTICKS) ?? []).reduce((length, run) => Math.max(length, run.length), 0);
    const ticks = "`".repeat(longest + 1);
    const pad = line.startsWith("`") || line.endsWith("`") ? " " : "";

    return `${ticks}${pad}${line}${pad}${ticks}`;
  }

  private static plain(text: string): string {
    return text.replace(/\r\n?/g, "\n").replaceAll("\0", "�");
  }

  private static opening(line: string): CodeFence | undefined {
    const match = SafeMarkdown.OPENING_FENCE.exec(line);

    if (match === null) return undefined;

    const [, indent = "", run = "", info = ""] = match;
    const char = run.charAt(0);

    if (char === "`" && info.includes("`")) return undefined;

    return { char, length: run.length, indent: indent.length };
  }

  private static closes(line: string, fence: CodeFence): boolean {
    const run = line.replace(/^ {0,3}/, "").replace(/[ \t]+$/, "");

    return run.length >= fence.length && run === fence.char.repeat(run.length);
  }

  private static unindented(line: string, indent: number): string {
    let spaces = 0;

    while (spaces < indent && (line.charAt(spaces) === " " || line.charAt(spaces) === "\t")) spaces++;

    return line.slice(spaces);
  }

  private static inline(line: string): string {
    let safe = "";
    let at = 0;

    while (at < line.length) {
      const char = line.charAt(at);
      const next = line.charAt(at + 1);

      if (char === "\\" && next !== "" && SafeMarkdown.PUNCTUATION.includes(next)) {
        safe += char + next;
        at += 2;
      } else if (char === "`") {
        const length = SafeMarkdown.runLength(line, at);
        const close = SafeMarkdown.closingRun(line, at + length, length);
        const end = close < 0 ? at + length : close + length;

        safe += close < 0 ? "\\`".repeat(length) : line.slice(at, end);
        at = end;
      } else if (char === "<") {
        const link = SafeMarkdown.AUTOLINK.exec(line.slice(at))?.[0];
        const literal = next === "" || next === " " || next === "\t";

        safe += link ?? (literal ? "<" : "\\<");
        at += link?.length ?? 1;
      } else {
        safe += char;
        at += 1;
      }
    }

    return safe;
  }

  /**
   * The line with its two ends made safe for marks beside it: a first character that could join a mark before it and
   * a last one that could join a mark after it get a backslash, and a backslash that would escape what follows gets a
   * second one.
   */
  private static bounded(line: string): string {
    const start = SafeMarkdown.JOINS_BEFORE.includes(line.charAt(0)) && line !== "" ? `\\${line}` : line;

    if (SafeMarkdown.backslashesBefore(start, start.length) % 2 === 1) return `${start}\\`;

    const last = start.charAt(start.length - 1);
    const escaped = SafeMarkdown.backslashesBefore(start, start.length - 1) % 2 === 1;

    if (start === "" || escaped || !SafeMarkdown.JOINS_AFTER.includes(last)) return start;

    return `${start.slice(0, -1)}\\${last}`;
  }

  /** How many backslashes stand in a row right before the place `end` of the line. */
  private static backslashesBefore(line: string, end: number): number {
    let at = end;

    while (at > 0 && line.charAt(at - 1) === "\\") at--;

    return end - at;
  }

  private static runLength(line: string, from: number): number {
    let end = from;

    while (line.charAt(end) === "`") end++;

    return end - from;
  }

  /** Where the next run of exactly `length` backticks starts at or after `from`, or -1 when the line has none. */
  private static closingRun(line: string, from: number, length: number): number {
    let at = line.indexOf("`", from);

    while (at >= 0) {
      const run = SafeMarkdown.runLength(line, at);

      if (run === length) return at;

      at = line.indexOf("`", at + run);
    }

    return -1;
  }
}

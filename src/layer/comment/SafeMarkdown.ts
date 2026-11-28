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
 * - Outside code, text that would act on the platform is put into a code span, so it is shown as written and does
 *   nothing: a mention of a user or a team (`@name`, `@org/team`), which would notify them from the account the
 *   comment is sent from, and a reference to an issue or a pull request (`#12`, `owner/repo#12`, `owner#12`,
 *   `GH-12`), which would link it and leave a note there. A backslash before such an `@` or `#` is dropped, because
 *   the platform looks for them in the text as it is shown. A character reference that stands for `@` or `#`, such
 *   as `&#64;`, gets a backslash, so it is shown as written and makes neither; any other character reference, such as
 *   `&#65;`, stays whole, so its number is not taken for an issue. The address of a link that holds such
 *   text is cut by the code span, and the link is then shown as text. Two code spans cannot touch, because their
 *   backticks would be read as one mark: where such a code span would touch another, a zero-width space stands
 *   between the two.
 * - Code stays as it is: a fenced code block, and a code span that opens and closes on one line. So `Array<string>` in
 *   backticks and a `<div>` in a code block read as written, and so does an `@name` or a `#12` there.
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

  private static readonly BETWEEN_SPANS = "\u200b";

  private static readonly NAME_MARKS = "_./-";

  private static readonly DIGIT_0 = 0x30;

  private static readonly DIGIT_9 = 0x39;

  private static readonly UPPER_A = 0x41;

  private static readonly UPPER_Z = 0x5a;

  private static readonly LOWER_A = 0x61;

  private static readonly LOWER_Z = 0x7a;

  private static readonly MENTION = /@[A-Za-z0-9](?:[A-Za-z0-9_./-]*[A-Za-z0-9])?/y;

  private static readonly ISSUE = /#[0-9](?:[A-Za-z0-9_]*[A-Za-z0-9])?/y;

  private static readonly NAMED_ISSUE =
    /[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)?#[0-9](?:[A-Za-z0-9_]*[A-Za-z0-9])?/y;

  private static readonly SHORT_ISSUE = /GH-[0-9]+/iy;

  private static readonly ACTING_REFERENCE = /&(?:#0*(?:64|35);|#[xX]0*(?:40|23);|commat;|num;)/y;

  private static readonly DECIMAL_REFERENCE = /&#[0-9]{1,7};/y;

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
    const parts: string[] = [];
    let at = 0;
    let last = "";
    let afterSpan = false;

    const text = (shown: string): void => {
      parts.push(shown);
      last = shown.charAt(shown.length - 1);
      afterSpan = false;
    };

    const span = (code: string): void => {
      parts.push(afterSpan ? SafeMarkdown.BETWEEN_SPANS : "", code);
      last = "`";
      afterSpan = true;
    };

    while (at < line.length) {
      const char = line.charAt(at);
      const next = line.charAt(at + 1);
      const escaped = char === "\\" && (next === "@" || next === "#");
      const acting = SafeMarkdown.acting(line, escaped ? at + 1 : at, last);
      const reference = char === "&" ? SafeMarkdown.matched(SafeMarkdown.DECIMAL_REFERENCE, line, at) : undefined;

      if (acting !== undefined) {
        span(`\`${acting}\``);
        at += acting.length + (escaped ? 1 : 0);
      } else if (char === "&" && SafeMarkdown.matched(SafeMarkdown.ACTING_REFERENCE, line, at) !== undefined) {
        text("\\&");
        at += 1;
      } else if (reference !== undefined) {
        text(reference);
        at += reference.length;
      } else if (char === "\\" && next !== "" && SafeMarkdown.PUNCTUATION.includes(next)) {
        text(char + next);
        at += 2;
      } else if (char === "`") {
        const length = SafeMarkdown.runLength(line, at);
        const close = SafeMarkdown.closingRun(line, at + length, length);
        const end = close < 0 ? at + length : close + length;

        if (close < 0) text("\\`".repeat(length));
        else span(line.slice(at, end));

        at = end;
      } else if (char === "<") {
        const link = SafeMarkdown.AUTOLINK.exec(line.slice(at))?.[0];
        const literal = next === "" || next === " " || next === "\t";

        text(link ?? (literal ? "<" : "\\<"));
        at += link?.length ?? 1;
      } else {
        text(char);
        at += 1;
      }
    }

    return parts.join("");
  }

  /**
   * The text that starts at `at` and would act on the platform when it is shown: a mention, or a reference to an
   * issue. `before` is the character written before it. An `@` right after a letter or a digit, as in a mail address,
   * is no mention; after anything else it is one, also after a `_` or a `*`, which may be a mark that is not shown.
   * The same holds for the short form `GH-12`. A reference with a name before the `#` is taken whole from the start
   * of the name; where the name starts after a `_`, `.`, `/` or `-`, the `#` and its number are taken alone.
   */
  private static acting(line: string, at: number, before: string): string | undefined {
    const char = line.charAt(at);

    if (char === "@") {
      return SafeMarkdown.isWord(before) ? undefined : SafeMarkdown.matched(SafeMarkdown.MENTION, line, at);
    }

    if (char === "#") return SafeMarkdown.matched(SafeMarkdown.ISSUE, line, at);

    if (!SafeMarkdown.isWord(char) || SafeMarkdown.isWord(before)) return undefined;

    const short = SafeMarkdown.matched(SafeMarkdown.SHORT_ISSUE, line, at);

    if (short !== undefined) return short;

    return before !== "" && SafeMarkdown.NAME_MARKS.includes(before)
      ? undefined
      : SafeMarkdown.matched(SafeMarkdown.NAMED_ISSUE, line, at);
  }

  /** Whether `char` is an ASCII letter or digit. */
  private static isWord(char: string): boolean {
    const code = char.charCodeAt(0);

    return (
      (code >= SafeMarkdown.DIGIT_0 && code <= SafeMarkdown.DIGIT_9) ||
      (code >= SafeMarkdown.UPPER_A && code <= SafeMarkdown.UPPER_Z) ||
      (code >= SafeMarkdown.LOWER_A && code <= SafeMarkdown.LOWER_Z)
    );
  }

  /** What `pattern`, which matches at one place only, finds at the place `at` of the line. */
  private static matched(pattern: RegExp, line: string, at: number): string | undefined {
    pattern.lastIndex = at;

    return pattern.exec(line)?.[0];
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

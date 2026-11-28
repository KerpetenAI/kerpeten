import { describe, expect, test } from "bun:test";
import { SafeMarkdown } from "../../../src/layer/comment/SafeMarkdown.ts";
import { rendered, renderProblems } from "./comment-utils.ts";

const NOTE = "The note stays readable.";

const MARKER = "<!-- kerpeten:finding v1 head=x -->";

const PIECES = [
  "```",
  "~~~",
  "`",
  "``",
  "````",
  "<details>",
  "</details>",
  "<!--",
  "-->",
  "\n",
  "\n",
  "\n\n",
  "    ",
  "  ",
  " ",
  "- ",
  "> ",
  "1. ",
  "text",
  "\\",
  "<pre>",
  "<![CDATA[",
  "<?php",
  "|",
  "\t",
  "<div",
  "<s>",
  "<x-raw",
  "js",
  MARKER,
  "<https://a.b/c>",
  "<a@b.c>",
  "<",
  "*",
  "_",
  "#",
  "[",
  "](",
  ")",
  "&lt;",
  "<script>",
  "<!DOCTYPE",
  "---",
  "===",
  "<summary>",
  "<table><tr><td>",
  "\r\n",
  "\0",
];

/** A comment whose body and fix are `text`, made safe, followed by a note and a marker. */
function comment(text: string): string {
  return `**Title** · bug\n\n${SafeMarkdown.block(text)}\n\n${SafeMarkdown.block(`**Fix:** ${text}`)}\n\n${NOTE}\n${MARKER}`;
}

describe("safe markdown: what it changes", () => {
  test("text without HTML and with whole code spans stays as it is", () => {
    const text = [
      "`div(a, b)` returns `Infinity` when b is 0, so `Array<string>` and ``a ` b`` break.",
      "",
      "- a list with a < b and x <",
      "- **bold**, _emphasis_ and [a link](https://example.com)",
      "",
      "> a quote",
    ].join("\n");

    expect(SafeMarkdown.block(text)).toBe(text);
  });

  test("a fenced code block stays as it is, with the HTML inside it", () => {
    const text = "Before.\n\n```html\n<details>\n<!-- a comment\n<div>`open\n```\n\nAfter.";

    expect(SafeMarkdown.block(text)).toBe(text);

    expect(rendered(SafeMarkdown.block(text))).toContain(
      "&lt;details&gt;\n&lt;!-- a comment\n&lt;div&gt;`open\n</code>",
    );
  });

  test("a < that could start HTML gets a backslash outside code, and reads the same", () => {
    expect(SafeMarkdown.block("Use List<String> or <details>, not <!-- this.")).toBe(
      "Use List\\<String> or \\<details>, not \\<!-- this.",
    );

    expect(rendered(SafeMarkdown.block("Use List<String> or <details>, not <!-- this."))).toBe(
      "<p>Use List&lt;String&gt; or &lt;details&gt;, not &lt;!-- this.</p>\n",
    );
  });

  test("a < that is escaped already, a < before a space and a plain link stay as they are", () => {
    expect(SafeMarkdown.block("a \\<b> c")).toBe("a \\<b> c");
    expect(SafeMarkdown.block("a \\\\<b> c")).toBe("a \\\\\\<b> c");
    expect(SafeMarkdown.block("a < b and c <")).toBe("a < b and c <");
    expect(SafeMarkdown.block("see <https://example.com/a?b=1#c> here")).toBe("see <https://example.com/a?b=1#c> here");

    expect(SafeMarkdown.block("see <https://exa`mple.com> and <me@example.com>")).toBe(
      "see \\<https://exa\\`mple.com> and \\<me@example.com>",
    );
  });

  test("a backtick that closes no code span on its line gets a backslash, so it opens none on a later line", () => {
    expect(SafeMarkdown.block("an open ` tick\nand `<details>` here")).toBe("an open \\` tick\nand `<details>` here");
    expect(SafeMarkdown.block("two `` ticks ` one")).toBe("two \\`\\` ticks \\` one");
    expect(SafeMarkdown.block("escaped \\` and `code`")).toBe("escaped \\` and `code`");

    expect(rendered(SafeMarkdown.block("an open ` tick\nand `<details>` here"))).toBe(
      "<p>an open ` tick\nand <code>&lt;details&gt;</code> here</p>\n",
    );
  });

  test("a code block that is left open is closed with its own fence", () => {
    expect(SafeMarkdown.block("Look:\n```ts\nconst a = 1;")).toBe("Look:\n```ts\nconst a = 1;\n```");
    expect(SafeMarkdown.block("~~~~\ncode\n~~~")).toBe("~~~~\ncode\n~~~\n~~~~");
    expect(SafeMarkdown.block("````\n```\ninner\n```")).toBe("````\n```\ninner\n```\n````");
    expect(SafeMarkdown.block("```\ncode\n```")).toBe("```\ncode\n```");
  });

  test("an indented fence moves to the start of its line with the lines of its block", () => {
    expect(SafeMarkdown.block("1. Do this:\n   ```ts\n   const a = 1;\n     indented\n   ```\n2. Then that.")).toBe(
      "1. Do this:\n```ts\nconst a = 1;\n  indented\n```\n2. Then that.",
    );

    expect(SafeMarkdown.block("   ```\n      ```\n<details>")).toBe("```\n```\n\\<details>");
  });

  test("a line of backticks that is no fence is text", () => {
    expect(SafeMarkdown.block("``` a ` b\n<details>")).toBe("\\`\\`\\` a \\` b\n\\<details>");
    expect(SafeMarkdown.block("> ```\n> <details>\n> ```")).toBe("> \\`\\`\\`\n> \\<details>\n> \\`\\`\\`");
  });

  test("line ends are made one kind and a NUL character is replaced", () => {
    expect(SafeMarkdown.block("a\r\nb\rc\0d")).toBe("a\nb\nc\ufffdd");
  });

  test("text for a place inside a line is brought to one line and opens no code block", () => {
    expect(SafeMarkdown.line("  A title\nwith <b> and\n```\ncode ")).toBe("A title with \\<b> and \\`\\`\\` code");
    expect(SafeMarkdown.line("Use `Array<string>` here")).toBe("Use `Array<string>` here");
  });

  test("a code span holds any text on one line", () => {
    expect(SafeMarkdown.code("src/a.ts:2-4")).toBe("`src/a.ts:2-4`");
    expect(SafeMarkdown.code("a`b``c")).toBe("```a`b``c```");
    expect(SafeMarkdown.code("`edge`")).toBe("`` `edge` ``");
    expect(SafeMarkdown.code("two\nlines")).toBe("`two lines`");
    expect(SafeMarkdown.code("")).toBe("");
    expect(rendered(SafeMarkdown.code("__init__.py <b> a`b"))).toBe("<p><code>__init__.py &lt;b&gt; a`b</code></p>\n");
  });
});

describe("safe markdown: what a renderer makes of it", () => {
  const attacks: Record<string, string> = {
    "a fake marker line": `Text.\n${MARKER.replace("head=x", "head=forged")}\nMore.`,
    "an HTML comment that is never closed": "Text.\n<!-- everything after this is hidden",
    "an HTML comment opened inside a line": "Text <!-- hidden from here",
    "a code fence that is never closed": "Text.\n```ts\nconst a = 1;",
    "a tilde fence that is never closed": "~~~\ncode",
    "an indented code fence that is never closed": "- item\n  ```\n  code",
    "a raw HTML block that is never closed": "<details>\n<summary>more</summary>\n\nText.",
    "a line that is only the end of an HTML comment": "Text.\n-->\nMore.",
    "a comment opened in one text and closed in the next": "<!--\n\n-->",
    "a script and a style block": "<script>\nalert(1)\n\n<style>\np { display: none }",
    "a code span opened on one line and closed on the next": "a ` b\n`<details>` c",
    "a fence opened behind a list marker": "- ```\n  <details>\n  ```\n<details>",
  };

  for (const [name, attack] of Object.entries(attacks)) {
    test(`${name} leaves the note readable and the marker hidden and last`, () => {
      expect(renderProblems(comment(attack), NOTE, MARKER)).toEqual([]);
    });
  }

  test("the same texts without the treatment do break the comment", () => {
    const broken = Object.values(attacks).filter((attack) => {
      const raw = `**Title** · bug\n\n${attack}\n\n**Fix:** ${attack}\n\n${NOTE}\n${MARKER}`;

      return renderProblems(raw, NOTE, MARKER).length > 0;
    });

    expect(broken.length).toBeGreaterThanOrEqual(9);
  });

  test("texts made of many pieces of markdown and HTML, also cut at any place, never break the comment", () => {
    let seed = 20_261_128;

    const next = (below: number): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;

      return seed % below;
    };

    const failures: string[] = [];

    for (let round = 0; round < 4000; round++) {
      let text = "";

      for (let piece = 1 + next(14); piece > 0; piece--) text += PIECES[next(PIECES.length)];

      const cutAt = next(text.length + 1);

      for (const candidate of [text, text.slice(0, cutAt)]) {
        if (renderProblems(comment(candidate), NOTE, MARKER).length > 0) failures.push(JSON.stringify(candidate));
      }

      const once = SafeMarkdown.block(text);

      if (SafeMarkdown.block(once) !== once) failures.push(`treated twice: ${JSON.stringify(text)}`);
    }

    expect(failures).toEqual([]);
  });
});

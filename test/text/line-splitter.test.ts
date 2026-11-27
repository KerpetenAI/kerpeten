import { describe, expect, test } from "bun:test";
import { LineSplitter } from "../../src/text/LineSplitter.ts";
import type { SplitLine } from "../../src/text/types/text.ts";

function split(pieces: readonly string[], maxChars?: number): SplitLine[] {
  const splitter = new LineSplitter(maxChars);

  return [...pieces.flatMap((piece) => splitter.push(piece)), ...splitter.end()];
}

describe("LineSplitter", () => {
  test("gives the lines of LineSplitter.split however the text is cut into pieces", () => {
    for (const text of [
      "",
      "a",
      "\n",
      "a\r",
      "a\r\nb\rc\n\n",
      "﻿﻿one\r\ntwo",
      "﻿",
      "x\r\r\ny\n",
      "\u{1F600}\r\n\u{1F600}",
    ]) {
      const whole = LineSplitter.split(text);

      for (let size = 1; size <= Math.max(1, text.length); size++) {
        const pieces: string[] = [];

        for (let at = 0; at < text.length; at += size) pieces.push(text.slice(at, at + size));

        expect({ text, size, lines: split(pieces).map((line) => line.text) }).toEqual({ text, size, lines: whole });
      }
    }
  });

  test("drops one byte order mark at the start, even when it comes alone", () => {
    expect(split(["", "﻿", "a\n"]).map((line) => line.text)).toEqual(["a"]);
    expect(split(["a", "﻿\n"]).map((line) => line.text)).toEqual(["a﻿"]);
  });

  test("cuts a long line while it arrives, keeps whole characters and does not count a CR before LF", () => {
    expect(split(["abcdef\n", "abc\r", "\nab", "c"], 3)).toEqual([
      { text: "abc", cut: true },
      { text: "abc", cut: false },
      { text: "abc", cut: false },
    ]);

    expect(split(["ab\u{1F600}cd\n"], 3)).toEqual([{ text: "ab", cut: true }]);
    expect(split(["abc\r"], 3)).toEqual([{ text: "abc", cut: true }]);
    expect(split(["x".repeat(10_000), "x".repeat(10_000), "\n"], 5)).toEqual([{ text: "xxxxx", cut: true }]);
  });
});

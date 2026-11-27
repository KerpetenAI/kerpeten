import { describe, expect, test } from "bun:test";
import { cut } from "../../src/text/text-utils.ts";

describe("Text.cut", () => {
  test("keeps text within the limit and never ends on a lone high surrogate", () => {
    expect(cut("abc", 3)).toEqual({ text: "abc", cut: false });
    expect(cut("abcd", 3)).toEqual({ text: "abc", cut: true });
    expect(cut("ab\u{1F600}", 3)).toEqual({ text: "ab", cut: true });
    expect(cut("\u{1F600}", 1)).toEqual({ text: "", cut: true });
    expect(cut("abc", 0)).toEqual({ text: "", cut: true });
  });
});

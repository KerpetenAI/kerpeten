import { describe, expect, test } from "bun:test";
import { CandidateFilter } from "../../../src/harnesses/review/CandidateFilter.ts";
import type { ReviewerFinding } from "../../../src/harnesses/review/types/review.ts";
import { LineSplitter } from "../../../src/text/LineSplitter.ts";

const finding = (start: number, end: number): ReviewerFinding => ({
  file: "src/a.ts",
  start_line: start,
  end_line: end,
  category: "bug",
  title: "t",
  body: "b",
  fix: "f",
  evidence: [{ location: "src/a.ts:1" }],
});

describe("finding paths", () => {
  test("normalizes to the BRIDGE form", () => {
    expect(CandidateFilter.normalizePath("./src/a.ts")).toBe("src/a.ts");
    expect(CandidateFilter.normalizePath("././src//a.ts")).toBe("src/a.ts");
    expect(CandidateFilter.normalizePath("src\\win\\a.ts")).toBe("src/win/a.ts");
    expect(CandidateFilter.normalizePath("çalış/ü.ts")).toBe("çalış/ü.ts");
  });

  test("refuses paths that leave the repository or name nothing", () => {
    for (const bad of ["", "./", "/etc/passwd", "../x", "src/../../x", "src/./a.ts", "src/", "a\nb", "a\0b"]) {
      expect({ bad, path: CandidateFilter.normalizePath(bad) }).toEqual({ bad, path: undefined });
    }
  });
});

describe("candidate check", () => {
  const lines = LineSplitter.split("﻿one\r\ntwo\n\n   \nfive\n");

  test("splits lines without a phantom last line", () => {
    expect(lines).toEqual(["one", "two", "", "   ", "five"]);
    expect(LineSplitter.split("")).toEqual([]);
    expect(LineSplitter.split("a")).toEqual(["a"]);
  });

  test("keeps a range inside the file", () => {
    expect(CandidateFilter.check(finding(1, 5), lines)).toEqual({
      kind: "keep",
      finding: finding(1, 5),
      clipped: false,
    });
  });

  test("drops a missing or unreadable file, a reversed range, a line past the end and an all-blank range", () => {
    expect(CandidateFilter.check(finding(1, 1), "missing")).toEqual({ kind: "drop", reason: "no_file" });
    expect(CandidateFilter.check(finding(1, 1), "unreadable")).toEqual({ kind: "drop", reason: "unreadable_file" });
    expect(CandidateFilter.check(finding(3, 2), lines)).toEqual({ kind: "drop", reason: "bad_range" });
    expect(CandidateFilter.check(finding(5, 6), lines)).toEqual({ kind: "drop", reason: "line_outside" });
    expect(CandidateFilter.check(finding(3, 4), lines)).toEqual({ kind: "drop", reason: "blank_range" });
    expect(CandidateFilter.check(finding(1, 1), [])).toEqual({ kind: "drop", reason: "line_outside" });
  });

  test("clips a range longer than 50 lines to the first 50", () => {
    const long = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`);

    expect(CandidateFilter.check(finding(10, 10 + CandidateFilter.MAX_FINDING_LINES), long)).toEqual({
      kind: "keep",
      finding: finding(10, 10 + CandidateFilter.MAX_FINDING_LINES - 1),
      clipped: true,
    });

    expect(CandidateFilter.check(finding(10, 10 + CandidateFilter.MAX_FINDING_LINES - 1), long)).toMatchObject({
      clipped: false,
    });
  });

  test("judges blankness on the clipped range", () => {
    const text = [...Array.from({ length: 50 }, () => ""), "code"];

    expect(CandidateFilter.check(finding(1, 51), text)).toEqual({ kind: "drop", reason: "blank_range" });
  });
});

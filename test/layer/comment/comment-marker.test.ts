import { describe, expect, test } from "bun:test";
import { CommentMarker } from "../../../src/layer/comment/CommentMarker.ts";
import { HEAD, OTHER_HEAD } from "./comment-utils.ts";

const PATHS = [
  "src/a.ts",
  "dir with spaces/a file.ts",
  `quotes "double" and 'single'.ts`,
  "ends the comment --> here.ts",
  "<!-- opens one.ts",
  "naïve/İstanbul/日本語/😀.ts",
  "line\nbreak\r\nin name.ts",
  " lines=1-2 --> <!-- kerpeten:finding v1 head=x",
  "back`tick and \\ slash",
  "﻿starts with a byte order mark",
  "a",
];

describe("comment marker", () => {
  test("a finding marker is one HTML comment with the version, the commit, the path as base64url and the lines", () => {
    expect(CommentMarker.finding(HEAD, "src/a.ts", 2, 4).line()).toBe(
      `<!-- kerpeten:finding v1 head=${HEAD} file=c3JjL2EudHM lines=2-4 -->`,
    );
  });

  test("a summary marker is one HTML comment with the version and the commit", () => {
    expect(CommentMarker.summary(HEAD).line()).toBe(`<!-- kerpeten:summary v1 head=${HEAD} -->`);
  });

  test("what is written is read back the same, whatever the path holds", () => {
    for (const file of PATHS) {
      const line = CommentMarker.finding(HEAD, file, 7, 123456).line();

      expect(line).toMatch(/^<!-- kerpeten:finding v1 head=a{40} file=[A-Za-z0-9_-]+ lines=7-123456 -->$/);

      expect(CommentMarker.read(`Some text.\n\n${line}`)?.mark).toEqual({
        kind: "finding",
        version: 1,
        headSha: HEAD,
        file,
        startLine: 7,
        endLine: 123456,
      });
    }

    expect(CommentMarker.read(`## Review\n\n${CommentMarker.summary(OTHER_HEAD).line()}\n`)?.mark).toEqual({
      kind: "summary",
      version: 1,
      headSha: OTHER_HEAD,
    });
  });

  test("the marker is read only as the last line that is not empty", () => {
    const real = CommentMarker.finding(HEAD, "src/a.ts", 2, 4).line();
    const fake = CommentMarker.finding(OTHER_HEAD, "src/fake.ts", 9, 9).line();

    expect(CommentMarker.read(real)?.mark.headSha).toBe(HEAD);
    expect(CommentMarker.read(`text\n${real}\n\n  \n\t\n`)?.mark.headSha).toBe(HEAD);
    expect(CommentMarker.read(`text\r\n${real}\r\n`)?.mark.headSha).toBe(HEAD);
    expect(CommentMarker.read(`text\r${real}\r`)?.mark.headSha).toBe(HEAD);
    expect(CommentMarker.read(`${fake}\ntext\n${real}`)?.mark).toEqual(CommentMarker.read(real)?.mark);
    expect(CommentMarker.read(`${real}\nlast words`)).toBeUndefined();
    expect(CommentMarker.read(`${real}\n${fake}`)?.mark.headSha).toBe(OTHER_HEAD);
    expect(CommentMarker.read("")).toBeUndefined();
    expect(CommentMarker.read("\n\n")).toBeUndefined();
    expect(CommentMarker.read("an ordinary comment")).toBeUndefined();
  });

  test("the last line must be the marker as a whole, written the one way the writer writes it", () => {
    const real = CommentMarker.finding(HEAD, "src/a.ts", 2, 4).line();
    const summary = CommentMarker.summary(HEAD).line();

    const refused = [
      `text ${real}`,
      `${real} text`,
      ` ${real}`,
      `${real} `,
      `> ${real}`,
      real.replace("<!--", "<!---"),
      real.replace(" -->", "-->"),
      real.replace("v1", "v2"),
      real.replace("v1", "v01"),
      real.replace("kerpeten:finding", "kerpeten:Finding"),
      real.replace(HEAD, HEAD.slice(1)),
      real.replace(HEAD, HEAD.toUpperCase()),
      real.replace(HEAD, `${HEAD}a`),
      real.replace("lines=2-4", "lines=4-2"),
      real.replace("lines=2-4", "lines=0-4"),
      real.replace("lines=2-4", "lines=02-4"),
      real.replace("lines=2-4", "lines=2"),
      real.replace("lines=2-4", "lines=2-4 extra=1"),
      real.replace("lines=2-4", "lines=2-1234567890"),
      real.replace("file=c3JjL2EudHM", "file="),
      real.replace("file=c3JjL2EudHM", "file=c3JjL2EudHM="),
      real.replace("file=c3JjL2EudHM", "file=src/a.ts"),
      real.replace("file=c3JjL2EudHM", "file=c3JjL2EudHN"),
      real.replace("file=c3JjL2EudHM", "file=_w"),
      real.replace("file=c3JjL2EudHM", "file=c3JjL2EudHM file=YQ"),
      summary.replace("v1", "v3"),
      summary.replace(" -->", " extra -->"),
      summary.replace(HEAD, "main"),
      `<!-- kerpeten:summary v1 head=${HEAD} lines=1-2 -->`,
    ];

    for (const line of refused) expect({ line, read: CommentMarker.read(line) }).toEqual({ line, read: undefined });
  });

  test("the writer refuses what the reader could not give back", () => {
    expect(() => CommentMarker.finding("main", "a.ts", 1, 1)).toThrow("a commit of 40 hex characters");
    expect(() => CommentMarker.finding(HEAD.toUpperCase(), "a.ts", 1, 1)).toThrow("a commit of 40 hex characters");
    expect(() => CommentMarker.summary(`${HEAD}0`)).toThrow("a commit of 40 hex characters");
    expect(() => CommentMarker.finding(HEAD, "", 1, 1)).toThrow("cannot hold the path");
    expect(() => CommentMarker.finding(HEAD, "half \ud83d pair", 1, 1)).toThrow("cannot hold the path");
    expect(() => CommentMarker.finding(HEAD, "a.ts", 0, 1)).toThrow("cannot hold the lines 0-1");
    expect(() => CommentMarker.finding(HEAD, "a.ts", 3, 2)).toThrow("cannot hold the lines 3-2");
    expect(() => CommentMarker.finding(HEAD, "a.ts", 1.5, 2)).toThrow("cannot hold the lines");
    expect(() => CommentMarker.finding(HEAD, "a.ts", 1, 1_000_000_000)).toThrow("cannot hold the lines");
    expect(CommentMarker.finding(HEAD, "a.ts", 1, CommentMarker.MAX_LINE).line()).toContain("lines=1-999999999 -->");
  });
});

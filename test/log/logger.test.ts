import { describe, expect, test } from "bun:test";
import { Logger } from "../../src/log/Logger.ts";

const at = new Date("2026-11-21T10:15:00.000Z");

describe("log", () => {
  test("drops lines below the configured level", () => {
    const lines: string[] = [];
    const log = new Logger({ level: "warn", write: (line) => lines.push(line), now: () => at });

    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines).toEqual(['2026-11-21T10:15:00.000Z WARN "w"', '2026-11-21T10:15:00.000Z ERROR "e"']);
  });

  test("quotes values that would break the key=value form and skips undefined", () => {
    const line = Logger.formatLine(at, "info", "a\nb", {
      plain: "src/a.ts:12",
      spaced: "two words",
      newline: "x\ny",
      empty: "",
      count: 3,
      nan: Number.NaN,
      ok: true,
      missing: undefined,
      "bad key": "v",
    });

    expect(line).toBe(
      '2026-11-21T10:15:00.000Z INFO "a\\nb" plain=src/a.ts:12 spaced="two words" newline="x\\ny" empty="" count=3 nan="NaN" ok=true "bad key"=v',
    );

    expect(line.includes("\n")).toBe(false);
  });

  test("child loggers carry bound fields and call fields win", () => {
    const lines: string[] = [];

    const log = new Logger({ level: "debug", write: (line) => lines.push(line), now: () => at }).child({
      command: "review",
      step: "a",
    });

    log.info("m", { step: "b" });
    expect(lines).toEqual(['2026-11-21T10:15:00.000Z INFO "m" command=review step=b']);
  });

  test("parses level names and refuses anything else", () => {
    expect(Logger.parseLevel(" WARN ")).toBe("warn");
    expect(Logger.parseLevel("debug")).toBe("debug");
    expect(Logger.parseLevel("verbose")).toBeUndefined();
    expect(Logger.parseLevel("")).toBeUndefined();
    expect(Logger.parseLevel(undefined)).toBeUndefined();
  });
});

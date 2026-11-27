import { cut } from "./text-utils.ts";
import type { SplitLine } from "./types/text.ts";

export class LineSplitter {
  private readonly maxChars: number;
  private started = false;
  private kept = "";
  private length = 0;
  private last = "";

  public constructor(maxChars = Number.POSITIVE_INFINITY) {
    this.maxChars = maxChars;
  }

  public static split(text: string): string[] {
    const splitter = new LineSplitter();

    return [...splitter.push(text), ...splitter.end()].map((line) => line.text);
  }

  public push(text: string): SplitLine[] {
    let chunk = text;

    if (!this.started && chunk !== "") {
      this.started = true;

      if (chunk.startsWith("﻿")) chunk = chunk.slice(1);
    }

    const lines: SplitLine[] = [];
    let start = 0;

    for (let newline = chunk.indexOf("\n"); newline >= 0; newline = chunk.indexOf("\n", start)) {
      this.append(chunk, start, newline);
      lines.push(this.finish(true));
      start = newline + 1;
    }

    this.append(chunk, start, chunk.length);

    return lines;
  }

  public end(): SplitLine[] {
    return this.length > 0 ? [this.finish(false)] : [];
  }

  private append(chunk: string, from: number, to: number): void {
    if (to <= from) return;

    const room = this.maxChars + 1 - this.kept.length;

    if (room > 0) this.kept += chunk.slice(from, Math.min(to, from + room));

    this.length += to - from;
    this.last = chunk.charAt(to - 1);
  }

  private finish(newline: boolean): SplitLine {
    let length = this.length;
    let kept = this.kept;

    if (newline && this.last === "\r") {
      length -= 1;

      if (kept.length > length) kept = kept.slice(0, length);
    }

    this.kept = "";
    this.length = 0;
    this.last = "";

    if (length <= this.maxChars) return { text: kept, cut: false };

    return { text: cut(kept, this.maxChars).text, cut: true };
  }
}

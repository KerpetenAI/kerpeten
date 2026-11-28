import type { CutText } from "./types/text.ts";

const RAW_CONTROL = /[\u007f-\u009f]/g;

function isControl(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function terminalLine(text: string): string {
  let line = "";

  for (const char of oneLine(text)) line += isControl(char.charCodeAt(0)) ? "�" : char;

  return line;
}

export function cut(text: string, max: number): CutText {
  if (text.length <= max) return { text, cut: false };

  const end = max > 0 && isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max;

  return { text: text.slice(0, end), cut: true };
}

export function shortLine(text: string, max: number): string {
  return cut(oneLine(text), max).text;
}

export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(RAW_CONTROL, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

export function firstLine(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { lstatSync, readFileSync, type Stats, statSync } from "node:fs";
import { errorMessage } from "../text/text-utils.ts";
import type { ErrnoLike, JsonFileResult, TextFileResult } from "./types/files.ts";

function errorCode(error: unknown): string {
  const code = (error as ErrnoLike | null)?.code;

  if (typeof code === "string") return code;

  return errorMessage(error);
}

export function readText(path: string, maxBytes: number): TextFileResult {
  let stat: Stats;

  try {
    stat = statSync(path);
  } catch (error) {
    const code = errorCode(error);
    const reason = code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable";

    return { ok: false, reason, error: `${path}: cannot be read (${code})` };
  }

  if (!stat.isFile()) return { ok: false, reason: "not_file", error: `${path}: not a regular file` };

  const tooLarge = { ok: false, reason: "too_large", error: `${path}: larger than ${maxBytes} bytes` } as const;

  if (stat.size > maxBytes) return tooLarge;

  let bytes: Uint8Array;

  try {
    bytes = readFileSync(path);
  } catch (error) {
    return { ok: false, reason: "unreadable", error: `${path}: cannot be read (${errorCode(error)})` };
  }

  if (bytes.length > maxBytes) return tooLarge;

  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, reason: "not_utf8", error: `${path}: not UTF-8` };
  }
}

export function readJson(path: string, maxBytes: number): JsonFileResult {
  const file = readText(path, maxBytes);

  if (!file.ok) return { ok: false, error: file.error };

  try {
    return { ok: true, value: JSON.parse(file.text) };
  } catch {
    return { ok: false, error: `${path}: not valid JSON` };
  }
}

export function regularFile(path: string): Stats | undefined {
  try {
    const stat = statSync(path);

    return stat.isFile() ? stat : undefined;
  } catch {
    return undefined;
  }
}

export function exists(path: string): boolean {
  try {
    lstatSync(path);

    return true;
  } catch {
    return false;
  }
}

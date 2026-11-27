import type { PermissionGrant } from "./capability/types/capability.ts";

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export function isPermission(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)*$/.test(value);
}

export function grants(grant: PermissionGrant, permission: string): boolean {
  return grant.every || grant.permissions.includes(permission);
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;

  const end = max > 0 && isHighSurrogate(text.charCodeAt(max - 1)) ? max - 1 : max;

  return `${text.slice(0, end)}...`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorText(error: unknown, max: number): string {
  return cut(errorMessage(error), max);
}

function briefValue(value: unknown): string {
  if (typeof value === "string") return value;

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * A tool call input as one short line for a log: `key=value` pairs for an object, the value itself otherwise, cut
 * at `max` characters. It reads no meaning into the keys.
 */
export function briefInput(input: unknown, max: number): string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return cut(briefValue(input), max);

  const pairs = Object.entries(input).map(([key, value]) => `${key}=${briefValue(value)}`);

  return cut(pairs.join(" "), max);
}

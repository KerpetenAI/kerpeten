import type { z } from "zod";

function pointer(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "/" : `/${path.map(String).join("/")}`;
}

function missingKey(data: unknown, path: readonly PropertyKey[]): boolean {
  let node = data;

  for (const key of path.slice(0, -1)) {
    if (typeof node !== "object" || node === null) return false;

    node = (node as Record<PropertyKey, unknown>)[key];
  }

  const key = path.at(-1);

  return (
    typeof key === "string" &&
    typeof node === "object" &&
    node !== null &&
    !Array.isArray(node) &&
    !Object.hasOwn(node, key)
  );
}

function describeIssue(issue: z.core.$ZodIssue, data: unknown): string[] {
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => `${pointer(issue.path)}: unknown key ${JSON.stringify(key)}`);
  }

  if (missingKey(data, issue.path)) {
    return [`${pointer(issue.path.slice(0, -1))}: missing required key ${JSON.stringify(issue.path.at(-1))}`];
  }

  return [`${pointer(issue.path)}: ${issue.message}`];
}

export function issueMessages(issues: readonly z.core.$ZodIssue[], data: unknown): string[] {
  return issues.flatMap((issue) => describeIssue(issue, data));
}

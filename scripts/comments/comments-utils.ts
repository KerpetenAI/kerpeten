import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import type { CommentPosition, SourceScan } from "./types/comments.ts";

const CHECKED_EXTENSIONS: ReadonlySet<string> = new Set([".ts", ".mjs"]);

const SKIPPED_PREFIXES: readonly string[] = ["node_modules/", "dist/"];

const GENERATED = /\.generated\.ts$/;

const REGEX_AFTER_WORDS: ReadonlySet<string> = new Set([
  "return",
  "typeof",
  "instanceof",
  "case",
  "in",
  "of",
  "void",
  "delete",
  "throw",
  "new",
  "else",
  "do",
  "yield",
  "await",
  "default",
  "extends",
]);

function isIdentifierStart(c: string): boolean {
  return /[A-Za-z_$\u0080-￿]/.test(c);
}

function isIdentifierPart(c: string): boolean {
  return /[A-Za-z0-9_$\u0080-￿]/.test(c);
}

function isPropertyName(text: string, i: number): boolean {
  let k = i - 1;

  while (k >= 0 && /\s/.test(text[k] ?? "")) k--;

  return text[k] === "." && text[k - 1] !== ".";
}

function isDocComment(text: string, i: number): boolean {
  const start = text.lastIndexOf("\n", i - 1) + 1;

  return text[i + 2] === "*" && text[i + 3] !== "/" && text.slice(start, i).trim() === "";
}

function lineEnd(text: string, i: number): number {
  const end = text.indexOf("\n", i);

  return end < 0 ? text.length : end;
}

function skipQuoted(text: string, i: number, quote: string): number {
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (c === "\\") {
      i += 2;
    } else if (c === quote || c === "\n") {
      return i + 1;
    } else {
      i++;
    }
  }

  return n;
}

function regexEnd(text: string, i: number): number | undefined {
  const n = text.length;
  let inClass = false;

  while (i < n) {
    const c = text[i];

    if (c === "\n") return undefined;

    if (c === "\\") {
      i += 2;
      continue;
    }

    if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") {
      inClass = true;
    } else if (c === "/") {
      i++;

      while (i < n && isIdentifierPart(text[i] ?? "")) i++;

      return i;
    }

    i++;
  }

  return undefined;
}

function scanComments(text: string): number[] {
  return scanSource(text).comments;
}

function scanSource(text: string): SourceScan {
  const found: number[] = [];
  const strings: [number, number][] = [];
  const n = text.length;
  const braces: ("brace" | "template")[] = [];
  let regexAllowed = true;
  let i = text.startsWith("#!") ? lineEnd(text, 0) : 0;

  const template = (start: number): number => {
    let j = start;

    while (j < n) {
      const c = text[j];

      if (c === "\\") {
        j += 2;
      } else if (c === "`") {
        strings.push([start, j]);

        return j + 1;
      } else if (c === "$" && text[j + 1] === "{") {
        strings.push([start, j]);
        braces.push("template");

        return -(j + 2);
      } else {
        j++;
      }
    }

    strings.push([start, n]);

    return n;
  };

  const resumeTemplate = (start: number): void => {
    const next = template(start);

    if (next < 0) {
      i = -next;
      regexAllowed = true;
    } else {
      i = next;
      regexAllowed = false;
    }
  };

  while (i < n) {
    const c = text[i] ?? "";
    const d = text[i + 1];

    if (c === "/" && d === "/") {
      found.push(i);
      i = lineEnd(text, i);
    } else if (c === "/" && d === "*") {
      if (!isDocComment(text, i)) found.push(i);

      const end = text.indexOf("*/", i + 2);

      i = end < 0 ? n : end + 2;
    } else if (c === "/") {
      const end = regexAllowed ? regexEnd(text, i + 1) : undefined;

      if (end === undefined) {
        i++;
        regexAllowed = true;
      } else {
        i = end;
        regexAllowed = false;
      }
    } else if (c === '"' || c === "'") {
      const end = skipQuoted(text, i + 1, c);

      strings.push([i + 1, Math.max(i + 1, end - 1)]);
      i = end;
      regexAllowed = false;
    } else if (c === "`") {
      resumeTemplate(i + 1);
    } else if (c === "{") {
      braces.push("brace");
      i++;
      regexAllowed = true;
    } else if (c === "}") {
      const top = braces.pop();

      if (top === "template") {
        resumeTemplate(i + 1);
      } else {
        i++;
        regexAllowed = true;
      }
    } else if (isIdentifierStart(c)) {
      let j = i + 1;

      while (j < n && isIdentifierPart(text[j] ?? "")) j++;

      const word = text.slice(i, j);

      regexAllowed = REGEX_AFTER_WORDS.has(word) && !isPropertyName(text, i);
      i = j;
    } else if (/[0-9]/.test(c)) {
      let j = i + 1;

      while (j < n && /[0-9A-Za-z_.]/.test(text[j] ?? "")) j++;

      i = j;
      regexAllowed = false;
    } else if (c === ")" || c === "]") {
      i++;
      regexAllowed = false;
    } else if (/\s/.test(c)) {
      i++;
    } else if ((c === "+" || c === "-") && d === c && !regexAllowed) {
      i += 2;
    } else if (c === "!" && d !== "=" && !regexAllowed) {
      i++;
    } else {
      i++;
      regexAllowed = true;
    }
  }

  return { comments: found, strings };
}

export function findComments(text: string): CommentPosition[] {
  const lineStarts = [0];

  for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineStarts.push(i + 1);

  return scanComments(text).map((offset) => {
    let line = lineStarts.length - 1;

    while ((lineStarts[line] ?? 0) > offset) line--;

    return { line: line + 1, column: offset - (lineStarts[line] ?? 0) + 1 };
  });
}

export function isChecked(path: string): boolean {
  if (!CHECKED_EXTENSIONS.has(extname(path))) return false;
  if (SKIPPED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;

  return !GENERATED.test(path);
}

function git(args: readonly string[], cwd: string): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });

  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim() || `git ${args[0]} failed`);

  return result.stdout.toString();
}

export function runNoComments(cwd: string): number {
  let root: string;
  let listed: string;

  try {
    root = git(["rev-parse", "--show-toplevel"], cwd).trim();
    listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], root);
  } catch (error) {
    console.error(`no-comments: ${error instanceof Error ? error.message : String(error)}`);

    return 2;
  }

  const paths = [...new Set(listed.split("\0").filter(Boolean))].sort();
  const problems: string[] = [];
  let scanned = 0;

  for (const path of paths) {
    if (!isChecked(path)) continue;

    const full = join(root, path);

    if (!existsSync(full) || !statSync(full).isFile()) continue;

    scanned++;

    for (const comment of findComments(readFileSync(full, "utf8"))) {
      problems.push(`${path}:${comment.line}:${comment.column}: comment`);
    }
  }

  for (const problem of problems) console.log(problem);

  if (problems.length > 0) {
    console.error(`no-comments: ${problems.length} problem(s) in ${scanned} scanned files`);

    return 1;
  }

  console.log(`no-comments: ${scanned} files scanned, no comments`);

  return 0;
}

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkBlankLines } from "../../scripts/check/check-utils.ts";

const dirs: string[] = [];

function project(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "blank-lines-"));

  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true }, include: ["*.ts"] }));
  writeFileSync(join(dir, "a.ts"), source);

  return dir;
}

async function reasons(source: string): Promise<string[]> {
  const report = await checkBlankLines(project(source), false);

  return report.violations.map((v) => `${v.line} ${v.reason}`);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("blank-lines", () => {
  test("accepts grouped imports, grouped one-line declarations and a first return", async () => {
    const source = [
      'import { a } from "./b.ts";',
      'import { c } from "./d.ts";',
      "",
      "export function f(): number {",
      "  return a + c;",
      "}",
      "",
      "export const x = 1;",
      "export const y = 2;",
      "",
    ].join("\n");

    expect(await reasons(source)).toEqual([]);
  });

  test("asks for a blank line around multi-line statements, before return and between kinds", async () => {
    const source = [
      "export function f(n: number): number {",
      "  const a = n + 1;",
      "  if (a > 2) {",
      "    n++;",
      "  }",
      "  n++;",
      "  return n;",
      "}",
      "",
    ].join("\n");

    expect(await reasons(source)).toEqual([
      "3 before a statement that spans several lines",
      "6 after a statement that spans several lines",
      "7 before return or throw",
    ]);
  });

  test("asks for a blank line between class members except one-line fields", async () => {
    const source = [
      "export class A {",
      "  public a = 1;",
      "  public b = 2;",
      "  public f(): number {",
      "    return this.a;",
      "  }",
      "  public g(): number {",
      "    return this.b;",
      "  }",
      "}",
      "",
    ].join("\n");

    expect(await reasons(source)).toEqual(["4 between class members", "7 between class members"]);
  });

  test("ignores blank-looking text inside template literals and writes the fix", async () => {
    const source = ["export function f(): string {", "  const a = `x", "y`;", "  return a;", "}", ""].join("\n");

    const dir = project(source);

    expect((await checkBlankLines(dir, true)).violations.map((v) => v.line)).toEqual([4]);

    expect(readFileSync(join(dir, "a.ts"), "utf8")).toBe(
      ["export function f(): string {", "  const a = `x", "y`;", "", "  return a;", "}", ""].join("\n"),
    );

    expect((await checkBlankLines(dir, false)).violations).toEqual([]);
  });
});

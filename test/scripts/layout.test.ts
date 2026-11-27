import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkLayout, runLayout } from "../../scripts/check/check-utils.ts";
import { LayoutRules } from "../../scripts/check/LayoutRules.ts";
import type { LayoutReport } from "../../scripts/check/types/check.ts";

const dirs: string[] = [];

function project(files: Record<string, string>, include: readonly string[] = ["**/*.ts"]): string {
  const dir = mkdtempSync(join(tmpdir(), "layout-"));

  dirs.push(dir);
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { noEmit: true }, include }));

  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }

  return dir;
}

function lines(...text: string[]): string {
  return `${text.join("\n")}\n`;
}

const GOOD: Record<string, string> = {
  "src/cli/main.ts": lines('import { run } from "./cli-utils.ts";', "", "if (import.meta.main) {", "  run();", "}"),
  "src/cli/cli-utils.ts": lines(
    "const LIMIT = 3;",
    "",
    "const PATTERN = /a/;",
    "",
    "export function run(): number {",
    "  return PATTERN.test('a') ? LIMIT : 0;",
    "}",
  ),
  "src/cli/Cli.ts": lines(
    'import { run } from "./cli-utils.ts";',
    "",
    "export class Cli {",
    "  public static readonly MAX = 2;",
    "",
    "  public go(): number {",
    "    return run() + Cli.MAX;",
    "  }",
    "}",
  ),
  "src/cli/types/cli.ts": lines(
    'import type { Cli } from "../Cli.ts";',
    "",
    "export interface Io {",
    "  readonly cli: Cli;",
    "  readonly shape: { readonly a: string };",
    "}",
    "",
    'export type Mode = "a" | "b";',
    "",
    'export type { Other } from "./other.ts";',
  ),
  "src/cli/types/other.ts": lines("export type Other = number;"),
  "src/cli/Mode.ts": lines("export enum Mode {", "  A = 0,", "}"),
  "src/cli/types/assets.d.ts": lines('declare module "*.md" {', "  const text: string;", "  export default text;", "}"),
  "src/cli/types/lib.d.ts": lines(
    'declare module "lib" {',
    "  interface Lib {",
    "    readonly a: string;",
    "  }",
    "",
    "  export const lib: Lib;",
    "}",
  ),
  "src/cli/types/api.generated.ts": lines("export enum Generated {", "  A,", "}", "", "export class Free {}"),
  "src/cli/schemas/cli-schema.ts": lines(
    'import { z } from "zod";',
    "",
    "const name = z.string();",
    "",
    "export const cliSchema = z.object({ name });",
  ),
  "src/cli/Command.decorator.ts": lines(
    "const SPECS = new WeakMap<object, string>();",
    "",
    "export function Command(name: string) {",
    "  return (target: object): void => {",
    "    SPECS.set(target, name);",
    "  };",
    "}",
    "",
    "export function commandSpec(target: object): string | undefined {",
    "  return SPECS.get(target);",
    "}",
  ),
  "src/cli/index.ts": lines('export { Cli } from "./Cli.ts";', 'export type { Io } from "./types/cli.ts";'),
  "scripts/tool.ts": lines(
    'import { run } from "../src/cli/cli-utils.ts";',
    "",
    "if (import.meta.main) process.exit(run());",
  ),
  "scripts/tool/tool-utils.ts": lines("export function tool(): number {", "  return 1;", "}"),
  "test/cli/cli.test.ts": lines(
    'import { expect, test } from "bun:test";',
    "",
    "const value = 1;",
    "",
    "const twice = (n: number): number => n * 2;",
    "",
    "function shape(): { a: number } {",
    "  return { a: value };",
    "}",
    "",
    'test("twice", () => {',
    "  expect(twice(shape().a)).toBe(2);",
    "});",
  ),
  "test/cli/cli-utils.ts": lines(
    'export const TOKEN = "t";',
    "",
    "export function token(): string {",
    "  return TOKEN;",
    "}",
  ),
  "test/cli/FakeCli.ts": lines(
    "export class FakeCli {",
    "  public shape(): { a: number } {",
    "    return { a: 1 };",
    "  }",
    "}",
  ),
};

const BAD: Record<string, string> = {
  "src/a/types/stray.d.ts": lines("export {};"),
  "src/a/stray.d.ts": lines("export {};"),
  "src/a/api.generated.ts": lines("export const a = 1;"),
  "src/a/a.test.ts": lines("export const a = 1;"),
  "other/Thing.ts": lines("export class Thing {}"),
  "src/a/Two.ts": lines("export class Two {}", "", "export class Three {}"),
  "src/a/Mixed.ts": lines("export class Mixed {}", "", "export function helper(): void {}"),
  "src/a/Hidden.ts": lines("class Hidden {}", "", "export const hidden = new Hidden();"),
  "src/a/Default.ts": lines("export default class Default {}"),
  "src/a/Empty.ts": lines("export const EMPTY = 1;"),
  "src/a/Reexport.ts": lines("export class Reexport {}", "", 'export { Two } from "./Two.ts";'),
  "src/a/review-command.ts": lines("export class ReviewCommand {}"),
  "src/a/Wrong.ts": lines("export class Right {}"),
  "src/a/Shade.ts": lines("export enum Color {", "  A = 0,", "}"),
  "src/a/Both.ts": lines("export class Both {}", "", "export enum Mode {", "  A = 0,", "}"),
  "src/a/Local.ts": lines("enum Local {", "  A = 0,", "}"),
  "src/a/types/value.ts": lines(
    'import { z } from "zod";',
    'import { type A } from "./other.ts";',
    "",
    "export type B = A | typeof z;",
    "",
    "export const x = 1;",
    "",
    "export function f(): void {}",
    "",
    "export class C {}",
    "",
    "export { y } from './other.ts';",
  ),
  "src/b/b-utils.ts": lines(
    "export class C {}",
    "",
    "export interface I {}",
    "",
    "export type T = string;",
    "",
    "export const VALUE = 1;",
    "",
    "const arrow = (): number => 1;",
    "",
    "let counter = 0;",
    "",
    "counter++;",
    "",
    "export default function main(): number {",
    "  return arrow() + counter;",
    "}",
  ),
  "test/b/b-utils.ts": lines("export const VALUE = 1;", "", "export const arrow = (): number => VALUE;"),
  "src/b/other-utils.ts": lines("export function other(): void {}"),
  "src/b/schemas/b-schema.ts": lines(
    'import { z } from "zod";',
    "",
    "export const ok = z.string();",
    "",
    "export function make(): void {}",
    "",
    "export const build = () => z.number();",
    "",
    "export class C {}",
    "",
    "export interface I {}",
    "",
    "z.string();",
  ),
  "src/b/schemas/thing.ts": lines('import { z } from "zod";', "", "export const thing = z.string();"),
  "src/b/types/BadName.ts": lines("export type A = string;"),
  "test/b/BadCase.test.ts": lines('import { test } from "bun:test";', "", 'test("x", () => {});'),
  "scripts/BuildAll.ts": lines("if (import.meta.main) process.exit(0);"),
  "src/c/tool.decorator.ts": lines("export function Tool(): void {}"),
  "src/c/Many.decorator.ts": lines(
    "const SPECS = new WeakMap<object, string>();",
    "",
    "const MORE = 1;",
    "",
    "export const LEAK = 2;",
    "",
    "export function Many(): void {}",
    "",
    "export function manySpec(): void {}",
    "",
    "export function manyOther(): number {",
    "  return MORE + LEAK + (SPECS.has({}) ? 1 : 0);",
    "}",
    "",
    "export class Holder {}",
  ),
  "src/c/Bad.decorator.ts": lines("function Bad(): void {}", "", "Bad();"),
  "scripts/run.ts": lines(
    "function go(): number {",
    "  return 0;",
    "}",
    "",
    "if (import.meta.main) process.exit(go());",
  ),
  "scripts/none.ts": lines('import { run } from "../src/b/b-utils.ts";', "", "run;"),
  "scripts/two.ts": lines("if (import.meta.main) process.exit(0);", "if (import.meta.main) process.exit(1);"),
  "scripts/other.ts": lines(
    "if (import.meta.main) process.exit(0);",
    "",
    "if (process.argv.length > 2) process.exit(1);",
  ),
  "scripts/else.ts": lines("if (import.meta.main) process.exit(0);", "else process.exit(1);"),
  "src/c/index.ts": lines(
    'import { a } from "./a.ts";',
    "",
    'export { b } from "./b.ts";',
    "",
    "export const c = a;",
    "",
    "export { a };",
  ),
  "test/c/c.test.ts": lines(
    'import { test } from "bun:test";',
    "",
    "class Fake {}",
    "",
    "interface Shape {",
    "  readonly a: number;",
    "}",
    "",
    "type Alias = Shape;",
    "",
    'test("x", () => {',
    "  const made = class {};",
    "",
    "  return [new Fake(), made] as unknown as Alias;",
    "});",
  ),
  "src/c/Shape.ts": lines(
    "export class Shape {",
    "  public shape(): { a: number } {",
    "    return { a: 1 };",
    "  }",
    "}",
  ),
  "scripts/c/Shape.ts": lines("export class Shape {", "  public value: { a: number } = { a: 1 };", "}"),
  "src/d/Local.ts": lines(
    "export class Local {",
    "  public readonly made = class {};",
    "",
    "  public build(): object {",
    "    class Inner {}",
    "",
    "    type Alias = Inner;",
    "",
    "    interface Shape {",
    "      readonly a: Alias;",
    "    }",
    "",
    "    return [new Inner()] as unknown as Shape;",
    "  }",
    "}",
  ),
  "src/d/d-utils.ts": lines(
    "export function make(): object {",
    "  class Made {}",
    "",
    "  type Kind = Made;",
    "",
    "  return new Made() as Kind;",
    "}",
  ),
  "test/d/d.test.ts": lines(
    'import { test } from "bun:test";',
    "",
    'test("x", () => {',
    "  interface Local {",
    "    readonly a: number;",
    "  }",
    "",
    "  type Other = Local;",
    "",
    "  class Inside {}",
    "",
    "  return [new Inside()] as unknown as Other;",
    "});",
  ),
};

const EXPECTED: Record<string, readonly string[]> = {
  "kind/unknown": ["other/Thing.ts:1", "src/a/a.test.ts:1", "src/a/api.generated.ts:1", "src/a/stray.d.ts:1"],
  "kind/class": [
    "src/a/Both.ts:3",
    "src/a/Default.ts:1",
    "src/a/Empty.ts:1",
    "src/a/Empty.ts:1",
    "src/a/Hidden.ts:1",
    "src/a/Hidden.ts:3",
    "src/a/Local.ts:1",
    "src/a/Mixed.ts:3",
    "src/a/Reexport.ts:3",
    "src/a/Two.ts:3",
  ],
  "name/class": ["src/a/Shade.ts:1", "src/a/Wrong.ts:1", "src/a/review-command.ts:1"],
  "kind/types": [
    "src/a/types/stray.d.ts:1",
    "src/a/types/value.ts:1",
    "src/a/types/value.ts:2",
    "src/a/types/value.ts:6",
    "src/a/types/value.ts:8",
    "src/a/types/value.ts:10",
    "src/a/types/value.ts:12",
  ],
  "kind/utils": [
    "src/b/b-utils.ts:1",
    "src/b/b-utils.ts:3",
    "src/b/b-utils.ts:5",
    "src/b/b-utils.ts:7",
    "src/b/b-utils.ts:9",
    "src/b/b-utils.ts:11",
    "src/b/b-utils.ts:13",
    "src/b/b-utils.ts:15",
    "test/b/b-utils.ts:3",
  ],
  "name/utils": ["src/b/other-utils.ts:1"],
  "kind/schema": [
    "src/b/schemas/b-schema.ts:5",
    "src/b/schemas/b-schema.ts:7",
    "src/b/schemas/b-schema.ts:9",
    "src/b/schemas/b-schema.ts:11",
    "src/b/schemas/b-schema.ts:13",
  ],
  "kind/decorator": [
    "src/c/Bad.decorator.ts:1",
    "src/c/Bad.decorator.ts:3",
    "src/c/Many.decorator.ts:3",
    "src/c/Many.decorator.ts:5",
    "src/c/Many.decorator.ts:11",
    "src/c/Many.decorator.ts:15",
    "src/c/tool.decorator.ts:1",
  ],
  "kind/entry": [
    "scripts/else.ts:1",
    "scripts/else.ts:1",
    "scripts/none.ts:1",
    "scripts/none.ts:3",
    "scripts/other.ts:3",
    "scripts/run.ts:1",
    "scripts/two.ts:2",
  ],
  "kind/barrel": ["src/c/index.ts:1", "src/c/index.ts:5", "src/c/index.ts:7"],
  "kind/test": ["test/c/c.test.ts:3", "test/c/c.test.ts:5", "test/c/c.test.ts:9"],
  "type-literal": ["scripts/c/Shape.ts:2", "src/c/Shape.ts:2"],
  "name/case": [
    "scripts/BuildAll.ts:1",
    "src/b/schemas/thing.ts:1",
    "src/b/types/BadName.ts:1",
    "test/b/BadCase.test.ts:1",
  ],
  "nested-class": [
    "src/d/Local.ts:2",
    "src/d/Local.ts:5",
    "src/d/d-utils.ts:2",
    "test/c/c.test.ts:12",
    "test/d/d.test.ts:10",
  ],
  "nested-type": [
    "src/d/Local.ts:7",
    "src/d/Local.ts:9",
    "src/d/d-utils.ts:4",
    "test/d/d.test.ts:4",
    "test/d/d.test.ts:8",
  ],
};

let good: LayoutReport;
let bad: LayoutReport;

beforeAll(async () => {
  [good, bad] = await Promise.all([checkLayout(project(GOOD)), checkLayout(project(BAD))]);
}, 60_000);

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("layout rules", () => {
  test("accepts a file of every kind", () => {
    expect(good.violations).toEqual([]);
    expect(good.files).toBe(Object.keys(GOOD).length);
  });

  test("every rule has a fixture that breaks it", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...LayoutRules.RULES].sort());

    for (const rule of LayoutRules.RULES) expect(EXPECTED[rule]?.length ?? 0).toBeGreaterThan(0);
  });

  for (const rule of LayoutRules.RULES) {
    test(`${rule} rejects exactly its fixtures`, () => {
      const found = bad.violations.filter((v) => v.rule === rule).map((v) => `${v.file}:${v.line}`);

      expect(found.sort()).toEqual([...(EXPECTED[rule] ?? [])].sort());
    });
  }

  test("reports only the listed rules", () => {
    expect(bad.violations.filter((v) => !LayoutRules.RULES.includes(v.rule))).toEqual([]);
  });

  test("classifies paths into kinds", () => {
    expect(LayoutRules.kindOf("src/cli/main.ts")).toBe("entry");
    expect(LayoutRules.kindOf("src/other/main.ts")).toBe("class");
    expect(LayoutRules.kindOf("scripts/layout.ts")).toBe("entry");
    expect(LayoutRules.kindOf("scripts/check/LayoutRules.ts")).toBe("class");
    expect(LayoutRules.kindOf("src/api/types/api.generated.ts")).toBe("generated");
    expect(LayoutRules.kindOf("src/harnesses/types/assets.d.ts")).toBe("declaration");
    expect(LayoutRules.kindOf("test/cli/main.test.ts")).toBe("test");
    expect(LayoutRules.kindOf("test/tools/tools-utils.ts")).toBe("utils");
    expect(LayoutRules.kindOf("src/harness-kit/Tool.decorator.ts")).toBe("decorator");
    expect(LayoutRules.kindOf("src/harness-kit/cli/CLI.decorator.ts")).toBe("decorator");
    expect(LayoutRules.kindOf("src/harness-kit/index.ts")).toBe("barrel");
    expect(LayoutRules.kindOf("src/harness-kit/harness-kit-utils.ts")).toBe("utils");
    expect(LayoutRules.kindOf("src/harness-kit/cli/ExitCode.ts")).toBe("class");
    expect(LayoutRules.kindOf("src/config/schemas/config-schema.ts")).toBe("schema");
    expect(LayoutRules.kindOf("src/config/types/config.ts")).toBe("types");
    expect(LayoutRules.kindOf("main.ts")).toBe("unknown");
  });
});

describe("bun run layout", () => {
  test("fails on any violation and passes once it is fixed", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const logs = spyOn(console, "log").mockImplementation(() => {});

    try {
      const dir = project({ "src/a/Two.ts": lines("export class Two {}", "", "export class Three {}") });

      expect(await runLayout(dir)).toBe(1);

      expect(errors.mock.calls.flat()).toEqual([
        "src/a/Two.ts:3: kind/class: a class file holds one class, not also Three",
        "layout: 1 violations",
      ]);

      writeFileSync(join(dir, "src/a/Two.ts"), lines("export class Two {}"));

      expect(await runLayout(dir)).toBe(0);

      expect(logs.mock.calls.flat()).toEqual(["layout: 1 files ok"]);
    } finally {
      errors.mockRestore();
      logs.mockRestore();
    }
  }, 60_000);
});

describe("layout fails closed", () => {
  test("rejects a project with no source files", async () => {
    await expect(checkLayout(project({ "readme.txt": "x" }, ["*.ts"]))).rejects.toThrow();
  }, 60_000);

  test("rejects a directory without tsconfig.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "layout-"));

    dirs.push(dir);

    await expect(checkLayout(dir)).rejects.toThrow();
  }, 60_000);
});

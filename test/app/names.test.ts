import { expect, test } from "bun:test";
import { typeErrors } from "../test-utils.ts";

test("tsc catches a named value injected or registered under a wrong name or with a wrong type", async () => {
  const head = [
    'import { Inject } from "@asenajs/ioc";',
    'import { Names } from "../../src/app/Names.ts";',
    'import type { Instances } from "../../src/app/types/app.ts";',
    "",
  ];

  const errors = await typeErrors({
    "probe-names-good.ts": [
      ...head,
      "export class Good {",
      "  @Inject(Names.NOW)",
      "  private readonly now!: Instances[Names.NOW];",
      "",
      "  public read(): number {",
      "    return this.now();",
      "  }",
      "}",
    ].join("\n"),
    "probe-names-inject.ts": [
      ...head,
      "export class Typo {",
      "  @Inject(Names.NOWW)",
      "  private readonly now!: Instances[Names.NOWW];",
      "}",
    ].join("\n"),
    "probe-names-register.ts": [
      ...head,
      "export const wrong: Pick<Instances, Names.NOW | Names.CWD> = { [Names.NOW]: Date.now, [Names.CWD]: 7 };",
    ].join("\n"),
  });

  expect([...new Set(errors.map((error) => `${error.file}:${error.line}`))]).toEqual([
    "probe-names-inject.ts:6",
    "probe-names-inject.ts:7",
    "probe-names-register.ts:5",
  ]);
});

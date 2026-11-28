import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigFileWriter } from "../../src/capability/config/ConfigFileWriter.ts";
import { capabilitySpec, HarnessWiring, harnessSpec } from "../../src/harness-kit/index.ts";
import { Harnesses } from "../../src/harnesses/Harnesses.ts";

const root = join(import.meta.dir, "..", "..");
const IMPORT = /\bimport\b[^;]*\bConfigFileWriter\b[^;]*from\s*["'][^"']*ConfigFileWriter\.ts["']/;

test("only the init command and the composition root import the config file writer", () => {
  const importing = [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })]
    .filter((path) => IMPORT.test(readFileSync(join(root, path), "utf8")))
    .sort();

  expect(importing.length).toBeGreaterThan(1);

  expect(
    importing.filter((path) => path !== "src/app/KerpetenApp.ts" && !path.startsWith("src/workflow/init/")),
  ).toEqual([]);
});

test("no harness lists the permission of the config file writer or reaches it through a tool", () => {
  const permission = capabilitySpec(ConfigFileWriter).permission;

  expect(permission).toBe("config:write");

  for (const harness of Harnesses.ALL) {
    expect(harnessSpec(harness).permissions).not.toContain(permission);
    expect(HarnessWiring.needs(harness).map((need) => need.capability)).not.toContain("config-file-writer");
  }
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KerpetenApp } from "../../src/app/KerpetenApp.ts";
import { markedClasses } from "./arch-utils.ts";

const root = join(import.meta.dir, "..", "..");

const COMPONENT_DECORATORS = [
  "CLI",
  "Service",
  "Component",
  "Harness",
  "Tool",
  "FlowStep",
  "Workflow",
  "Capability",
  "RunService",
];

function sources(): readonly [string, string][] {
  return [...new Bun.Glob("src/**/*.ts").scanSync({ cwd: root })]
    .sort()
    .map((path) => [path, readFileSync(join(root, path), "utf8")]);
}

test("the container's component list holds every class of the program marked as a component, run components included", () => {
  const marked = sources()
    .filter(([path]) => !path.startsWith("src/harness-kit/"))
    .flatMap(([, source]) => markedClasses(source, COMPONENT_DECORATORS));

  expect(KerpetenApp.COMPONENTS.map((component) => component.name)).toEqual(expect.arrayContaining([...marked]));
});

test("no file under src/ builds a container component with new, apart from a class building its own copies", () => {
  const names = KerpetenApp.COMPONENTS.map((component) => component.name);

  const building = sources().flatMap(([path, source]) =>
    names
      .filter((name) => !path.endsWith(`/${name}.ts`) && new RegExp(`\\bnew ${name}\\(`).test(source))
      .map((name) => `${path}: new ${name}(`),
  );

  expect(building).toEqual([]);
});

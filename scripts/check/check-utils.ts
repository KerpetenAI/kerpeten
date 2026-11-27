import { writeFileSync } from "node:fs";
import { BlankLines } from "./BlankLines.ts";
import { LayoutRules } from "./LayoutRules.ts";
import { SourceProject } from "./SourceProject.ts";
import type { BlankLineReport, BlankLineViolation, LayoutReport, LayoutViolation } from "./types/check.ts";

export async function checkBlankLines(root: string, write: boolean): Promise<BlankLineReport> {
  const violations: BlankLineViolation[] = [];

  const files = await new SourceProject(root).each(
    (path) => BlankLines.checks(path),
    ({ file, path, source }) => {
      const rule = new BlankLines(path, source).check();

      violations.push(...rule.violations);

      if (write && rule.violations.length > 0) writeFileSync(file, rule.fixed());
    },
  );

  return { files, violations };
}

export async function runBlankLines(root: string, write: boolean): Promise<number> {
  const { files, violations } = await checkBlankLines(root, write);

  for (const v of violations) console.error(`${v.file}:${v.line}: blank line needed ${v.reason}`);

  if (write) {
    console.log(`blank-lines: fixed ${violations.length} places in ${files} files`);

    return 0;
  }

  if (violations.length > 0) {
    console.error(`blank-lines: ${violations.length} places need a blank line; run bun run format`);

    return 1;
  }

  console.log(`blank-lines: ${files} files ok`);

  return 0;
}

export async function checkLayout(root: string): Promise<LayoutReport> {
  const violations: LayoutViolation[] = [];

  const files = await new SourceProject(root).each(
    () => true,
    ({ path, source }) => {
      violations.push(...new LayoutRules(path, source).check().violations);
    },
  );

  violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));

  return { files, violations };
}

export async function runLayout(root: string): Promise<number> {
  const { files, violations } = await checkLayout(root);

  for (const v of violations) console.error(`${v.file}:${v.line}: ${v.rule}: ${v.message}`);

  if (violations.length > 0) {
    console.error(`layout: ${violations.length} violations`);

    return 1;
  }

  console.log(`layout: ${files} files ok`);

  return 0;
}

import { dirname, join, normalize } from "node:path";

export function markedClasses(source: string, decorators: readonly string[]): readonly string[] {
  const names = decorators.join("|");

  const pattern = new RegExp(
    `^@(?:${names})\\((?:(?!^@(?:${names})\\()[\\s\\S])*?^export (?:abstract )?class (\\w+)`,
    "gm",
  );

  return [...source.matchAll(pattern)].flatMap((found) => (found[1] === undefined ? [] : [found[1]]));
}

export function markedHarnesses(source: string): readonly string[] {
  return markedClasses(source, ["Harness"]);
}

const KIT = "@kerpetensh/harness-kit";

const KIT_ENTRIES: readonly string[] = [KIT, `${KIT}/ai-sdk`];

const KIT_FOLDERS: readonly string[] = ["src/harness-kit", "test/harness-kit", `node_modules/${KIT}`];

/**
 * Why the file `file` may not import `specifier`, or `undefined` when it may: the kit is taken as the package, through
 * its two entry points, never as a folder of this repository and never by a path into the package.
 */
export function kitImportProblem(file: string, specifier: string): string | undefined {
  if (specifier === KIT || specifier.startsWith(`${KIT}/`)) {
    return KIT_ENTRIES.includes(specifier) ? undefined : `${file} imports a path inside the kit package: ${specifier}`;
  }

  const target = specifier.startsWith(".") ? normalize(join(dirname(file), specifier)) : specifier;

  for (const folder of KIT_FOLDERS) {
    if (target === folder || target.startsWith(`${folder}/`) || target.includes(`/${folder}/`)) {
      return `${file} imports the kit by a file path: ${specifier}`;
    }
  }

  return undefined;
}

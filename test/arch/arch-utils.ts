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

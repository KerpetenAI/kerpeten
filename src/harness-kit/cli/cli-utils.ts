/** The names as command line flags: `--name`. */
export function flagNames(names: readonly string[]): readonly string[] {
  return names.map((name) => `--${name}`);
}

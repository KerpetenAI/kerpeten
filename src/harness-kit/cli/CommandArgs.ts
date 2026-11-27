import { flagNames } from "./cli-utils.ts";
import type { CommandSpec, ParsedValues } from "./types/cli.ts";
import { UsageError } from "./UsageError.ts";

/**
 * A command line as the CLI parsed it by the workflow's command spec, given to the workflow's `commandInput`: the
 * action word the line starts with, when the spec has `actions`, and the flags.
 */
export class CommandArgs {
  public readonly action: string | undefined;
  public readonly flags: ParsedValues;
  private readonly spec: CommandSpec;

  public constructor(spec: CommandSpec, action: string | undefined, flags: ParsedValues) {
    this.spec = spec;
    this.action = action;
    this.flags = flags;
  }

  /** The value of the string option `name`, or `undefined` when the line does not give it. */
  public string(name: string): string | undefined {
    const value = this.flags[name];

    return typeof value === "string" ? value : undefined;
  }

  /** Whether the line gives the boolean option `name`. */
  public boolean(name: string): boolean {
    return this.flags[name] === true;
  }

  /** The one flag of the spec's `oneOf` group the line gives, or its fallback; two flags throw a `UsageError`. */
  public choice(): string {
    const { name, oneOf } = this.spec;

    if (oneOf === undefined) throw new Error(`the ${name} command declares no oneOf flags`);

    const given = oneOf.flags.filter((flag) => this.flags[flag] === true);

    if (given.length > 1) {
      throw new UsageError(`give at most one ${oneOf.label} flag, not ${flagNames(given).join(" and ")}`);
    }

    return given[0] ?? oneOf.fallback;
  }
}

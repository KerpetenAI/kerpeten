import { parseArgs } from "node:util";
import { errorMessage } from "../harness-kit-utils.ts";
import { CommandArgs } from "./CommandArgs.ts";
import { flagNames } from "./cli-utils.ts";
import type { CommandOptions, CommandSpec } from "./types/cli.ts";
import { UsageError } from "./UsageError.ts";

/** The command line of one command of a CLI: its usage line and notes, and the parse of its arguments. */
export class CommandLine {
  public readonly program: string;
  public readonly spec: CommandSpec;
  public readonly description: string;

  public constructor(program: string, spec: CommandSpec, description: string) {
    this.program = program;
    this.spec = spec;
    this.description = description;
  }

  public get name(): string {
    return this.spec.name;
  }

  public usageLine(): string {
    const { name, usage, oneOf } = this.spec;
    const choice = oneOf === undefined ? "" : `[${flagNames(oneOf.flags).join(" | ")}]`;

    return [this.program, name, usage, choice].filter((part) => part !== "").join(" ");
  }

  public usageNotes(): readonly string[] {
    const { name, oneOf } = this.spec;

    if (oneOf === undefined) return [];

    return [
      `${name} ${oneOf.label}: at most one of ${flagNames(oneOf.flags).join(", ")}; --${oneOf.fallback} when none is given`,
    ];
  }

  /**
   * Parses the arguments after the command's name: the action word first when the spec has `actions`, then the flags,
   * with no positional argument. A line the spec does not take throws a `UsageError`.
   */
  public parse(args: readonly string[]): CommandArgs {
    const { actions } = this.spec;
    let action: string | undefined;
    let rest = args;

    if (actions !== undefined) {
      const [first, ...others] = args;

      action = actions.find((known) => known === first);

      if (action === undefined) throw new UsageError(`give one of ${actions.join(", ")}`);

      rest = others;
    }

    let flags: CommandArgs["flags"];

    try {
      flags = parseArgs({ args: [...rest], options: this.options(), allowPositionals: false, strict: true }).values;
    } catch (error) {
      throw new UsageError(errorMessage(error));
    }

    return new CommandArgs(this.spec, action, flags);
  }

  private options(): CommandOptions {
    return {
      ...this.spec.options,
      ...Object.fromEntries((this.spec.oneOf?.flags ?? []).map((flag) => [flag, { type: "boolean" } as const])),
    };
  }
}

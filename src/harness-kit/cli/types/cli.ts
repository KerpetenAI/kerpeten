import type { WorkflowBase } from "../../workflow/WorkflowBase.ts";
import type { CommandLine } from "../CommandLine.ts";

export interface Io {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

export type CommandOptions = Readonly<Record<string, { readonly type: "string" | "boolean" }>>;

export type ParsedValues = Readonly<Record<string, string | boolean | undefined>>;

/**
 * A group of boolean flags of which a command line gives at most one. `fallback` is the choice when it gives none;
 * `label` names the group in the usage notes and in the error for two flags.
 */
export interface OneOfSpec {
  readonly flags: readonly string[];
  readonly fallback: string;
  readonly label: string;
}

/**
 * What makes a workflow a command, the part of `@Workflow` a CLI reads. `name` is the word that runs it, `usage` the
 * text after that word in the usage line, `options` the flags `node:util` `parseArgs` takes. `actions` are the words of
 * which the command line must start with one, like `login | logout | status`. The workflow's description is the
 * command's description in the usage.
 */
export interface CommandSpec {
  readonly name: string;
  readonly usage: string;
  readonly options: CommandOptions;
  readonly oneOf?: OneOfSpec;
  readonly actions?: readonly string[];
}

/** A workflow class a CLI lists: one whose result is the exit code of the command. */
export type CommandClass = abstract new () => WorkflowBase<object, object, number>;

export interface CliSpec {
  readonly name: string;
  readonly version: string;
  /** The workflows marked with a `command`, in the order the usage lists them. */
  readonly commands: readonly CommandClass[];
}

/** A command of a started CLI: its command line and the workflow it runs. */
export interface ExposedCommand {
  readonly line: CommandLine;
  readonly workflow: WorkflowBase<object, object, number>;
}

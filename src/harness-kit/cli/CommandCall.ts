import { AsyncLocalStorage } from "node:async_hooks";
import type { Io } from "./types/cli.ts";

/**
 * The command a CLI is running: the program, the command's name and the CLI's output. The CLI enters it around the
 * workflow it runs, and the workflow and its flow steps read it with `this.command`. `report` writes a line about the
 * command on stderr, `<program> <command>: <message>`; `fail` does that and gives the exit code back.
 */
export class CommandCall {
  private static readonly CURRENT = new AsyncLocalStorage<CommandCall>();

  public readonly program: string;
  public readonly name: string;
  private readonly io: Io;

  public constructor(program: string, name: string, io: Io) {
    this.program = program;
    this.name = name;
    this.io = io;
  }

  public static enter<T>(call: CommandCall, run: () => T): T {
    return CommandCall.CURRENT.run(call, run);
  }

  /** The command that is running; `reader` names who reads it in the error thrown outside every command. */
  public static current(reader: string): CommandCall {
    const call = CommandCall.CURRENT.getStore();

    if (call === undefined) {
      throw new Error(`${reader} read its command outside a command; a CLI runs a workflow with a command`);
    }

    return call;
  }

  public report(message: string): void {
    this.io.err(`${this.program} ${this.name}: ${message}`);
  }

  public fail(code: number, message: string): number {
    this.report(message);

    return code;
  }
}

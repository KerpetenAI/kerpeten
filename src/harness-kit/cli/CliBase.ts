import { type Container, ICoreServiceNames, Inject, OnStart } from "@asenajs/ioc";
import { registeredName } from "../container/container-utils.ts";
import { KitNames } from "../container/KitNames.ts";
import type { KitInstances } from "../container/types/container.ts";
import { errorMessage } from "../harness-kit-utils.ts";
import type { WorkflowBase } from "../workflow/WorkflowBase.ts";
import { cliSpec } from "./CLI.decorator.ts";
import { CommandCall } from "./CommandCall.ts";
import { CommandLine } from "./CommandLine.ts";
import { ExitCode } from "./ExitCode.ts";
import type { CliSpec, ExposedCommand } from "./types/cli.ts";

/**
 * A command-line program. Its commands are the workflows with a `command` in their `@Workflow` spec that its `@CLI`
 * spec lists. When the container starts, it takes them in that order and stops the start when one of them is not
 * registered, has no command, has the command name of another or is listed by another CLI.
 *
 * It runs a command line in four steps: it parses the arguments by the workflow's command spec, has the workflow turn
 * them into its input with `commandInput`, runs the workflow inside a `CommandCall` and exits with its result. A line
 * that cannot be parsed or turned into the input prints its error and the usage and exits with 2.
 */
export abstract class CliBase {
  public readonly spec: CliSpec;

  @Inject(KitNames.IO)
  protected readonly io!: KitInstances[KitNames.IO];

  @Inject(ICoreServiceNames.CONTAINER)
  private readonly container!: Container;

  private readonly commands = new Map<string, ExposedCommand>();

  public constructor() {
    this.spec = cliSpec(new.target);
  }

  @OnStart()
  public async bindCommands(): Promise<void> {
    const missing: string[] = [];
    const names: string[] = [];

    for (const command of this.spec.commands) {
      const name = registeredName(this.container, command);

      if (name === undefined) missing.push(command.name);
      else names.push(name);
    }

    if (missing.length > 0) {
      throw new Error(
        `the CLI ${this.spec.name} lists ${missing.join(", ")}, which is not registered in the container`,
      );
    }

    for (const name of names) {
      const workflow = (await this.container.resolve(name)) as WorkflowBase<object, object, number>;
      const command = workflow.expose(this.spec.name);

      if (this.commands.has(command.name)) {
        throw new Error(`the CLI ${this.spec.name} lists two commands named ${command.name}`);
      }

      this.commands.set(command.name, {
        line: new CommandLine(this.spec.name, command, workflow.spec.description),
        workflow,
      });
    }
  }

  public get usage(): string {
    const { name, version } = this.spec;
    const lines = [...this.commands.values()].map((command) => command.line);

    return [
      `${name} ${version}`,
      "",
      "usage:",
      ...lines.flatMap((line) => [`  ${line.usageLine()}`, `      ${line.description}`]),
      `  ${name} --version | --help`,
      "",
      ...lines.flatMap((line) => line.usageNotes()),
    ].join("\n");
  }

  public async run(argv: readonly string[]): Promise<number> {
    const { io } = this;
    const [name, ...rest] = argv;

    if (name === undefined || name === "--help" || name === "-h" || name === "help") {
      io.out(this.usage);

      return name === undefined ? ExitCode.USAGE : ExitCode.OK;
    }

    if (name === "--version" || name === "-v") {
      io.out(this.spec.version);

      return ExitCode.OK;
    }

    const command = this.commands.get(name);

    if (command === undefined) {
      io.err(`${this.spec.name}: unknown command ${JSON.stringify(name)}`);
      io.err(this.usage);

      return ExitCode.USAGE;
    }

    const { line, workflow } = command;
    let input: object;

    try {
      input = workflow.commandInput(line.parse(rest));
    } catch (error) {
      io.err(`${this.spec.name} ${line.name}: ${errorMessage(error)}`);
      io.err(this.usage);

      return ExitCode.USAGE;
    }

    return CommandCall.enter(new CommandCall(this.spec.name, line.name, io), () => workflow.run(input));
  }
}

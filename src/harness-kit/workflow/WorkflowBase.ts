import { type Container, ICoreServiceNames, Inject } from "@asenajs/ioc";
import type { PermissionGrant } from "../capability/types/capability.ts";
import type { CommandArgs } from "../cli/CommandArgs.ts";
import { CommandCall } from "../cli/CommandCall.ts";
import type { CommandSpec } from "../cli/types/cli.ts";
import { FlowPlan } from "../container/FlowPlan.ts";
import { KitNames } from "../container/KitNames.ts";
import type { KitInstances } from "../container/types/container.ts";
import { HarnessWiring } from "../HarnessWiring.ts";
import { PermissionGroupSet } from "../PermissionGroupSet.ts";
import { Run } from "../run/Run.ts";
import { RunScope } from "../run/RunScope.ts";
import type { RunClass } from "../run/types/run.ts";
import type { OptionalGap } from "../types/wiring.ts";
import type { RunningPart, WorkflowSpec } from "./types/workflow.ts";
import { workflowSpec } from "./Workflow.decorator.ts";
import { WorkflowEnd } from "./WorkflowEnd.ts";

/**
 * A linear chain of flow steps over one shared state, a container singleton. `run` starts with the input, adds each
 * flow step's fields to the state in turn and builds the result with `finish`; a flow step that returns `this.end(result)`
 * ends the run with that result. A workflow is itself a flow step: listed in another workflow, it runs to its own result
 * and the fields of that result join the outer state, while its inner state stays hidden. Its flow steps are given once
 * with `bind`, by the kit's `WorkflowRegistry` when the container starts.
 *
 * `run` opens a run when none is open: its grant is that of the permission group `group` names, every permission when
 * it names none, and the container builds its run components.
 * Inside an open run, as a flow step of another workflow or called from a flow step, it joins that run. Either way the run's
 * grant is checked first against the harnesses the workflow reaches, and only those: a grant that misses a permission
 * one of them cannot run without ends the workflow with a `PermissionGroupError`, before anything of the run is
 * built. Then `admit` runs, the input joins the run's values, and the run builds the run components marked with
 * `@OnFlowStart` that the workflow reaches and runs their hooks, before the first flow step. A hook that throws ends the
 * workflow with its error. Before each flow step the run makes ready what the flow step takes with `@Use`.
 *
 * A run component that cannot be built ends the workflow: after the flow step that needed it, `run` throws the build's
 * error as it is, also when the flow step caught it or threw another error on its account.
 *
 * A workflow whose spec has a `command` is a command: a CLI that lists it parses the command line by that spec, turns
 * it into the input with `commandInput`, runs the workflow and exits with its result. A workflow without one is
 * internal: it runs only as a flow step of another workflow or called from one.
 */
export abstract class WorkflowBase<Input extends object, State extends Input, Result> {
  public readonly spec: WorkflowSpec;
  public readonly name: string;

  @Inject(ICoreServiceNames.CONTAINER)
  private readonly container!: Container;

  @Inject(KitNames.PERMISSION_GROUPS)
  private readonly permissionGroups!: KitInstances[KitNames.PERMISSION_GROUPS];

  private parts: readonly RunningPart[] | undefined;

  private program: string | undefined;

  public constructor() {
    this.spec = workflowSpec(new.target);

    this.name = this.spec.name;
  }

  /** The command that is running this workflow; read outside a command, it throws. */
  protected get command(): CommandCall {
    return CommandCall.current(`the workflow ${this.name}`);
  }

  protected abstract finish(state: State): Result | Promise<Result>;

  public bind(parts: readonly RunningPart[]): void {
    if (this.parts !== undefined) throw new Error(`the workflow ${this.name} already has its flow steps`);

    this.parts = parts;
  }

  /**
   * Marks the workflow as a command of the CLI `program` and gives its command spec. A workflow without a `command`
   * in its spec, or one a second CLI lists, throws.
   */
  public expose(program: string): CommandSpec {
    const { command } = this.spec;

    if (command === undefined) {
      throw new Error(`the CLI ${program} lists the workflow ${this.name}, which has no command in its @Workflow spec`);
    }

    if (this.program !== undefined) {
      throw new Error(`the workflow ${this.name} is listed by two CLIs, ${this.program} and ${program}`);
    }

    this.program = program;

    return command;
  }

  /**
   * Turns the parsed command line into the workflow's input. A workflow with a `command` overrides it; a line it
   * cannot take throws a `UsageError`, and the CLI prints the error and the usage.
   */
  public commandInput(_args: CommandArgs): Input {
    throw new Error(`the workflow ${this.name} does not turn a command line into its input; it overrides commandInput`);
  }

  public async run(input: Input): Promise<Result> {
    const { parts } = this;

    if (parts === undefined) {
      throw new Error(
        `the workflow ${this.name} has no flow steps; the WorkflowRegistry gives them when the container starts`,
      );
    }

    const open = RunScope.find();

    if (open !== undefined) return this.chain(parts, input, open);

    let grant: PermissionGrant;

    try {
      grant = this.grant(input);
    } catch (error) {
      return this.rescue(error, input);
    }

    const run = new Run(grant, { container: this.container });

    return RunScope.enter(run, () => this.chain(parts, input, run));
  }

  public execute(state: Input): Promise<Result> {
    return this.run(state);
  }

  /**
   * The permission group a run this workflow opens for `input` gets. It names none, which gives every permission; a
   * workflow whose input names a group overrides it: `return input.group;`.
   */
  protected group(_input: Input): string | undefined {
    return undefined;
  }

  /**
   * The permission grant of a run this workflow opens for `input`: that of the group `group` names. A group the
   * program does not have throws a `PermissionGroupError`, which `rescue` gets. A workflow overrides it only for a
   * grant that comes from no group.
   */
  protected grant(input: Input): PermissionGrant {
    return this.permissionGroups.grant(this.group(input) ?? PermissionGroupSet.ALL);
  }

  /**
   * Runs once the grant of the run gives every permission the workflow's harnesses cannot run without, whether the
   * workflow opened the run or joined it, before anything of the run is built. `gaps` are the optional uses of those
   * harnesses' tools that the grant does not give. It does nothing by default; a workflow overrides it to report the
   * gaps, or to refuse a grant for a reason of its own by throwing.
   */
  protected admit(_input: Input, _grant: PermissionGrant, _gaps: readonly OptionalGap[]): void {}

  /**
   * Turns an error that ends the workflow into its result: one of `grant`, of the check of the run's grant, of
   * `admit`, of the run's flow start, of a flow step or of `finish`. `state` is the state when the error came: the input and what the flow steps before added. It throws the
   * error by default. A run whose build failed stays failed, so a workflow around this one still ends with that error.
   */
  protected rescue(error: unknown, _state: NoInfer<Input & Partial<State>>): Result | Promise<Result> {
    throw error;
  }

  private async chain(parts: readonly RunningPart[], input: Input, run: Run): Promise<Result> {
    let state: object = input;

    try {
      const plan = FlowPlan.of(this.container);
      const workflow = this.constructor as RunClass;

      this.admit(input, run.grant, HarnessWiring.admit(plan.harnesses(workflow, run), run.grant));
      run.join(input);

      await run.startFlow(plan.reached(workflow, run));

      for (const part of parts) {
        await run.prepare(part);

        let output: unknown;

        try {
          output = await part.execute(state);
        } catch (error) {
          run.throwFailure();

          throw error;
        }

        run.throwFailure();

        if (output instanceof WorkflowEnd) return output.result as Result;

        state = { ...state, ...(output as object) };
      }

      return await this.finish(state as State);
    } catch (error) {
      return this.rescue(error, state as Input & Partial<State>);
    }
  }
}

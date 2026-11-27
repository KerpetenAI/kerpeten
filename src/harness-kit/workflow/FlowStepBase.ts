import { CommandCall } from "../cli/CommandCall.ts";
import type { Run } from "../run/Run.ts";
import { RunScope } from "../run/RunScope.ts";
import { flowStepSpec } from "./FlowStep.decorator.ts";
import type { FlowStepSpec } from "./types/workflow.ts";
import { WorkflowEnd } from "./WorkflowEnd.ts";

/**
 * One flow step of a workflow, a container singleton. `execute` takes the state so far, typed as
 * `After<typeof PreviousStep>`, and returns the fields it adds, with no return type annotation so the next flow step
 * sees them. It ends the workflow early with `return this.end(result)`. A flow step injects the program's singletons; what
 * belongs to one run comes in the state or, for a run component, through a `@Use` field, which the run makes ready
 * before `execute` runs. It reads the run it is running in, its grant for one, through `this.run`, and the command
 * that runs its workflow, when a CLI runs one, through `this.command`.
 */
export abstract class FlowStepBase {
  public readonly spec: FlowStepSpec;
  public readonly name: string;

  public constructor() {
    this.spec = flowStepSpec(new.target);

    this.name = this.spec.name;
  }

  /** The run this flow step is running in; read outside a run, as outside `execute`, it throws. */
  protected get run(): Run {
    const run = RunScope.find();

    if (run === undefined) {
      throw new Error(
        `the flow step ${this.name} read its run outside a run; a flow step reads it only while it executes`,
      );
    }

    return run;
  }

  /** The command a CLI is running this flow step's workflow as; read outside a command, it throws. */
  protected get command(): CommandCall {
    return CommandCall.current(`the flow step ${this.name}`);
  }

  public abstract execute(state: never): object | Promise<object>;

  protected end<Result>(result: Result): WorkflowEnd<Result> {
    return new WorkflowEnd(result);
  }
}

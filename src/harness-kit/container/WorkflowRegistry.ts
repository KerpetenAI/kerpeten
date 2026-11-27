import { type Container, ICoreServiceNames, Inject, OnStart, Service } from "@asenajs/ioc";
import type { RunClass } from "../run/types/run.ts";
import { WiringError } from "../WiringError.ts";
import type { RunningPart } from "../workflow/types/workflow.ts";
import type { WorkflowBase } from "../workflow/WorkflowBase.ts";
import { registeredName, unregisteredUses } from "./container-utils.ts";
import { FlowPlan } from "./FlowPlan.ts";
import { KitKinds } from "./KitKinds.ts";

/**
 * Gives each workflow of the container its flow steps when the container starts: the singletons of the classes its spec
 * lists, in that order. A workflow listed as a flow step of another is the same singleton. A class a flow step takes with
 * `@Use`, or a run component takes in turn, that is not registered in the container stops the start. Everything is
 * resolved here, one after another; after the start only a run resolves: its run components, and the singletons they
 * take with `@Use` as the container holds them.
 *
 * Then it works out the container's `FlowPlan`, what each workflow reaches when it starts. A class of the container
 * marked with `@OnFlowStart` that is no run component stops the start.
 */
@Service("harness-kit:workflow-registry")
export class WorkflowRegistry {
  @Inject(ICoreServiceNames.CONTAINER)
  private readonly container!: Container;

  @OnStart()
  public async assemble(): Promise<void> {
    const workflows = (
      await this.container.resolveAll<WorkflowBase<object, object, unknown>>(KitKinds.WORKFLOW)
    ).flat();

    const problems: string[] = [];
    const ready: [WorkflowBase<object, object, unknown>, readonly RunningPart[]][] = [];

    for (const workflow of workflows) {
      const parts: RunningPart[] = [];

      for (const part of workflow.spec.steps) {
        const name = registeredName(this.container, part);

        if (name === undefined) {
          problems.push(`workflow ${workflow.name} lists ${part.name}, which is not registered in the container`);
          continue;
        }

        problems.push(...unregisteredUses(this.container, part, `flow step ${part.name}`));
        parts.push((await this.container.resolve(name)) as RunningPart);
      }

      ready.push([workflow, parts]);
    }

    if (problems.length > 0) throw new WiringError([...new Set(problems)]);

    const misplaced = FlowPlan.misplacedHooks(this.container);

    if (misplaced.length > 0) throw new WiringError(misplaced);

    const steps = new Map<RunClass, readonly RunClass[]>();

    for (const workflow of workflows) steps.set(workflow.constructor as RunClass, workflow.spec.steps);

    FlowPlan.keep(this.container, new FlowPlan(this.container, steps));

    for (const [workflow, parts] of ready) workflow.bind(parts);
  }
}

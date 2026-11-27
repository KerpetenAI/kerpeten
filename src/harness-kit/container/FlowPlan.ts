import { ComponentConstants, type Container, getChainedTypedMetadata, getOwnTypedMetadata } from "@asenajs/ioc";
import { CapabilityUses } from "../capability/CapabilityUses.ts";
import { harnessSpec } from "../Harness.decorator.ts";
import { FlowHooks } from "../run/FlowHooks.ts";
import type { Run } from "../run/Run.ts";
import type { RunClass } from "../run/types/run.ts";
import { toolSpec } from "../Tool.decorator.ts";
import type { HarnessClass } from "../types/harness.ts";
import { UnmarkedClassError } from "../UnmarkedClassError.ts";
import { registeredName } from "./container-utils.ts";
import { KitKinds } from "./KitKinds.ts";
import type { FlowEdge } from "./types/container.ts";

/**
 * What each workflow of a container reaches when it starts, worked out once when the container starts. From the
 * workflow's own flow steps it follows `@Use` and `@Inject`, a harness to its tools and every class to what it takes in
 * turn; it stops at a workflow, which reaches its own when it starts. A tool's `@Use` is followed only when the run's
 * grant gives the capability's permission, so `reached` and `harnesses` take the run. A class that is not registered
 * is left to the check that owns it, which stops the start.
 *
 * It also finds every class of the container marked with `@OnFlowStart` that is no run component.
 */
export class FlowPlan {
  private static readonly PLANS = new WeakMap<Container, FlowPlan>();

  private readonly container: Container;
  private readonly roots = new Map<RunClass, readonly RunClass[]>();
  private readonly edges = new Map<RunClass, readonly FlowEdge[]>();
  private readonly order: readonly RunClass[];

  public constructor(container: Container, workflows: ReadonlyMap<RunClass, readonly RunClass[]>) {
    this.container = container;

    for (const [workflow, steps] of workflows) {
      const roots = steps.filter((step) => !FlowPlan.isWorkflow(step)).map((step) => this.registered(step));

      this.roots.set(workflow, roots);

      for (const root of roots) this.walk(root);
    }

    this.order = this.dependenciesFirst();
  }

  /** The plan of the container; a container whose `WorkflowRegistry` did not start has none, and that throws. */
  public static of(container: Container): FlowPlan {
    const plan = FlowPlan.PLANS.get(container);

    if (plan === undefined) {
      throw new Error("the container has no flow plan; its WorkflowRegistry makes one when the container starts");
    }

    return plan;
  }

  public static keep(container: Container, plan: FlowPlan): void {
    FlowPlan.PLANS.set(container, plan);
  }

  /** One problem for each method of the container's classes marked with `@OnFlowStart` on a class that is no run component. */
  public static misplacedHooks(container: Container): readonly string[] {
    const problems: string[] = [];

    for (const entry of Object.values(container.services)) {
      for (const service of [entry].flat()) {
        const target = service.Class;

        if (getOwnTypedMetadata<boolean>(KitKinds.RUN, target) === true) continue;

        for (const hook of FlowHooks.of(target)) {
          problems.push(
            `${target.name}.${String(hook.method)} is marked with @OnFlowStart, but ${target.name} is no run component; only a capability with scope "run" or a @RunService has flow start hooks`,
          );
        }
      }
    }

    return problems;
  }

  private static isWorkflow(target: object): boolean {
    return getOwnTypedMetadata<boolean>(KitKinds.WORKFLOW, target) === true;
  }

  private static isTool(target: object): boolean {
    try {
      toolSpec(target);

      return true;
    } catch (error) {
      if (error instanceof UnmarkedClassError) return false;

      throw error;
    }
  }

  private static tools(target: object): readonly RunClass[] {
    return FlowPlan.harnessName(target) === undefined ? [] : harnessSpec(target).tools;
  }

  private static harnessName(target: object): string | undefined {
    try {
      return harnessSpec(target).name;
    } catch (error) {
      if (error instanceof UnmarkedClassError) return undefined;

      throw error;
    }
  }

  /**
   * The run components marked with `@OnFlowStart` that `workflow` reaches in `run`, each after the marked components it
   * takes with `@Use`, directly or through others.
   */
  public reached(workflow: RunClass, run: Run): readonly RunClass[] {
    const seen = this.seen(workflow, run);

    return this.order.filter((target) => seen.has(target));
  }

  /**
   * The harnesses `workflow` reaches in `run`, sorted by harness name: the ones its own flow steps can call. The harnesses
   * of a workflow it lists or calls are that workflow's.
   */
  public harnesses(workflow: RunClass, run: Run): readonly HarnessClass[] {
    const named: [string, HarnessClass][] = [];

    for (const target of this.seen(workflow, run)) {
      const name = FlowPlan.harnessName(target);

      if (name !== undefined) named.push([name, target]);
    }

    named.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

    return named.map(([, harness]) => harness);
  }

  private seen(workflow: RunClass, run: Run): ReadonlySet<RunClass> {
    const roots = this.roots.get(workflow);

    if (roots === undefined) {
      throw new Error(`the flow plan does not know the workflow class ${workflow.name}; it knows the registered ones`);
    }

    const seen = new Set<RunClass>();
    const open = [...roots];

    for (let next = open.pop(); next !== undefined; next = open.pop()) {
      if (seen.has(next)) continue;

      seen.add(next);

      for (const edge of this.edges.get(next) ?? []) {
        if (edge.gate === undefined || run.gives(edge.gate)) open.push(edge.target);
      }
    }

    return seen;
  }

  private registered(target: RunClass): RunClass {
    const name = registeredName(this.container, target);
    const entry = name === undefined ? undefined : this.container.services[name];

    return entry === undefined || Array.isArray(entry) ? target : entry.Class;
  }

  private walk(start: RunClass): void {
    const open = [start];

    for (let next = open.pop(); next !== undefined; next = open.pop()) {
      if (this.edges.has(next)) continue;

      const edges = this.edgesOf(next);

      this.edges.set(next, edges);
      open.push(...edges.map((edge) => edge.target));
    }
  }

  private edgesOf(owner: RunClass): readonly FlowEdge[] {
    if (FlowPlan.isWorkflow(owner)) return [];

    const gated = FlowPlan.isTool(owner);
    const edges: FlowEdge[] = [];

    for (const use of CapabilityUses.of(owner)) {
      edges.push({ target: this.registered(use.capability), gate: gated ? use.capability : undefined });
    }

    const injected = getChainedTypedMetadata<Record<string, string | undefined>>(
      ComponentConstants.DependencyKey,
      owner,
    );

    for (const name of Object.values(injected)) {
      const entry = name === undefined ? undefined : this.container.services[name];

      for (const service of entry === undefined ? [] : [entry].flat())
        edges.push({ target: service.Class, gate: undefined });
    }

    for (const tool of FlowPlan.tools(owner)) edges.push({ target: this.registered(tool), gate: undefined });

    return edges;
  }

  private dependenciesFirst(): readonly RunClass[] {
    const order: RunClass[] = [];
    const done = new Set<RunClass>();

    const visit = (target: RunClass): void => {
      if (done.has(target)) return;

      done.add(target);

      for (const use of CapabilityUses.of(target)) visit(this.registered(use.capability));

      if (FlowHooks.marks(target)) order.push(target);
    };

    for (const target of this.edges.keys()) visit(target);

    return order;
  }
}

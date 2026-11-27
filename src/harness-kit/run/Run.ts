import { type Container, StartHookError } from "@asenajs/ioc";
import { capabilitySpec } from "../capability/Capability.decorator.ts";
import { CapabilityUses } from "../capability/CapabilityUses.ts";
import type { CapabilityUse, PermissionGrant } from "../capability/types/capability.ts";
import { registeredName } from "../container/container-utils.ts";
import { RunGuard } from "../container/RunGuard.ts";
import { grants } from "../harness-kit-utils.ts";
import { PermissionError } from "../PermissionError.ts";
import { toolSpec } from "../Tool.decorator.ts";
import { UnmarkedClassError } from "../UnmarkedClassError.ts";
import { FlowHooks } from "./FlowHooks.ts";
import { RunScope } from "./RunScope.ts";
import type { RegisteredClass, RunClass, RunFailure, RunSetup } from "./types/run.ts";

/**
 * One run: its permission grant, its values, the instances it holds and the builds under way. The container builds
 * a run component once per run, the first time a tool, a flow step or another run component of the run needs it, with
 * what that component takes with `@Use` built first; parallel needs share one build. Before a tool or a flow step runs,
 * the kit makes ready everything it takes with `@Use`, so a field read only looks the instance up.
 *
 * A class is built as the class the container registered under its name. A class and a subclass registered under the
 * same name are therefore one component of the run: whichever is asked for, the run builds the registered class once.
 *
 * Run components that take each other with `@Use` in a cycle are an error, also when two parallel builds close the
 * cycle between them: the build that would wait for a build waiting for it throws instead.
 *
 * A class the container holds as a singleton, such as a capability without a scope, is no run component: the run
 * takes the container's one instance, the same in every run, and builds nothing for it.
 *
 * A tool's `@Use` is checked against the grant: a required use whose permission the grant does not give throws
 * `PermissionError` when read, an optional one reads `undefined`, and that capability is never built. A `@Use` of a
 * flow step or of a run component is not checked.
 *
 * A build that throws fails the run: the run keeps the first such error as its `failure`, and that error ends the
 * run's harness runs and its workflow, wherever the build was asked for.
 *
 * A run with no container holds only what it is given with `give`, as a self-check or a test gives a double.
 *
 * A harness runs only in a run a workflow started in, so the grant was checked against the harness first. A run opened
 * with `test: true` is the exception, for a test or a self-check that runs a harness on its own: there a use the grant
 * does not give fails at the tool call.
 *
 * The run's values start with those it is opened with; each workflow that starts in it adds its input with `join`. A
 * run component's `@OnFlowStart({ type: "run" })` methods run right after its build, before anything reads it; a
 * starting workflow has the run build what it reaches with `startFlow`, which also runs the `"workflow"` hooks.
 */
export class Run {
  private static readonly QUEUES = new WeakMap<Container, Promise<unknown>>();

  public readonly grant: PermissionGrant;
  private readonly values = new Map<string, unknown>();
  private readonly container: Container | undefined;
  private readonly builds = new Map<RunClass, Promise<object>>();
  private readonly instances = new Map<RunClass, object>();
  private readonly owners = new Map<RunClass, boolean>();
  private readonly waits = new Map<RunClass, RunClass>();
  private readonly given = new Set<object>();
  private readonly test: boolean;
  private flowing = false;
  private failed: RunFailure | undefined;

  public constructor(grant: PermissionGrant, setup: RunSetup = {}) {
    this.grant = grant;
    this.container = setup.container;
    this.test = setup.test === true;

    this.join(setup.values ?? {});
  }

  private static permission(target: RunClass): string | undefined {
    try {
      return capabilitySpec(target).permission;
    } catch (error) {
      if (error instanceof UnmarkedClassError) return undefined;

      throw error;
    }
  }

  private static isTool(target: RunClass): boolean {
    try {
      toolSpec(target);

      return true;
    } catch (error) {
      if (error instanceof UnmarkedClassError) return false;

      throw error;
    }
  }

  private static cycle(path: readonly RunClass[], target: RunClass): Error {
    const from = path.indexOf(target);

    return new Error(
      `the run components take each other with @Use in a cycle: ${[...path.slice(from), target].map((link) => link.name).join(" -> ")}`,
    );
  }

  /** The error of the run's first build that threw, or `undefined` while every build went through. */
  public get failure(): RunFailure | undefined {
    return this.failed;
  }

  /**
   * Throws unless a workflow started in this run or the run is a test run; `harness` names the harness that is about
   * to run in it.
   */
  public expectWorkflow(harness: string): void {
    if (this.flowing || this.test) return;

    throw new Error(
      `the harness ${harness} ran in a run no workflow started; a harness runs in a flow step of a workflow, and only a run opened with test: true runs one without`,
    );
  }

  /** Throws the error of the run's first build that threw; while every build went through it does nothing. */
  public throwFailure(): void {
    const { failed } = this;

    if (failed !== undefined) throw failed.error;
  }

  /**
   * Gives the run a ready instance of `target`, as a self-check or a test gives a double; the run never builds that
   * class. The run takes the instance as it is: it builds nothing the instance's class takes with `@Use`.
   */
  public give<T extends object>(target: RunClass<T>, instance: T): this {
    if (this.builds.has(target)) throw new Error(`the run already has ${target.name}`);

    this.instances.set(target, instance);
    this.builds.set(target, Promise.resolve(instance));
    this.given.add(instance);

    return this;
  }

  /**
   * Adds `values`, the input of a workflow that starts in this run, to the values its components read with
   * `@RunValue`. A key the run already has must come with the same value; another value throws an error that names the
   * key, and then no value is added.
   */
  public join(values: object): void {
    const entries = Object.entries(values);

    for (const [key, value] of entries) {
      if (this.values.has(key) && !Object.is(this.values.get(key), value)) {
        throw new Error(
          `the run already has the value ${JSON.stringify(key)} and a starting workflow brings another one; a workflow that joins a run may add values, not change them`,
        );
      }
    }

    for (const [key, value] of entries) this.values.set(key, value);
  }

  /**
   * Makes the run ready for a workflow that starts in it: builds each class of `targets` in the given order, which
   * runs its `"run"` hooks once in the run, then runs its `"workflow"` hooks. An instance given with `give` is taken
   * as it is, without its hooks.
   */
  public async startFlow(targets: readonly RunClass[]): Promise<void> {
    this.flowing = true;

    for (const target of targets) {
      const instance = await this.ready(target);

      if (this.given.has(instance)) continue;

      await RunScope.enter(this, () => FlowHooks.call(instance, "workflow"));
    }
  }

  /** The instance of `target` in this run, built first when the run has none yet. */
  public async ready<T extends object>(target: RunClass<T>): Promise<T> {
    return (await this.build(target, [])) as T;
  }

  /**
   * Makes ready everything the class of `owner` takes with `@Use`, so its fields can be read in this run. A tool's
   * use whose permission the grant does not give is left out.
   */
  public async prepare(owner: object): Promise<void> {
    const ownerClass = owner.constructor as RunClass;
    const gated = Run.isTool(ownerClass);

    for (const use of CapabilityUses.of(ownerClass)) {
      if (gated && !this.gives(use.capability)) continue;

      await this.build(use.capability, [ownerClass]);
    }

    this.owners.set(ownerClass, gated);
  }

  /** What a `@Use` field of `owner` reads: the instance of this run, checked against the grant for a tool. */
  public read(owner: object, use: CapabilityUse): unknown {
    const ownerClass = owner.constructor as RunClass;
    const name = `${ownerClass.name}.${use.field}`;
    const gated = this.owners.get(ownerClass);

    if (gated === undefined) {
      throw new Error(`${name} was read before the run made ${ownerClass.name} ready`);
    }

    if (gated && !this.gives(use.capability)) {
      if (!use.required) return undefined;

      throw new PermissionError(
        `${name} needs the capability ${capabilitySpec(use.capability).name}, which the permission group ${JSON.stringify(this.grant.group)} does not give`,
      );
    }

    const instance = this.instances.get(use.capability);

    if (instance === undefined) throw new Error(`${name} was read before the run made ${use.capability.name} ready`);

    return instance;
  }

  /** What a `@RunValue` field of `owner` reads: the value of this run under `key`. */
  public value(owner: object, field: string, key: string): unknown {
    if (!this.values.has(key)) {
      throw new Error(
        `${owner.constructor.name}.${field} reads the run value ${JSON.stringify(key)}, which this run does not have`,
      );
    }

    return this.values.get(key);
  }

  /** Whether the grant gives the permission of the capability `target`; a class without a permission is given. */
  public gives(target: RunClass): boolean {
    const permission = Run.permission(target);

    return permission === undefined || grants(this.grant, permission);
  }

  private build(asked: RunClass, path: readonly RunClass[]): Promise<object> {
    const target = this.builtClass(asked);

    if (path.includes(target)) return Promise.reject(Run.cycle(path, target));

    const started = this.builds.get(target) ?? this.start(target, path);

    if (target === asked) return started;

    return started.then((instance) => {
      this.instances.set(asked, instance);

      return instance;
    });
  }

  private start(target: RunClass, path: readonly RunClass[]): Promise<object> {
    const made = this.make(target, [...path, target]).catch((error: unknown) => {
      this.failed ??= { error };

      throw error;
    });

    this.builds.set(target, made);

    return made;
  }

  private builtClass(asked: RunClass): RunClass {
    const { container } = this;

    if (container === undefined || this.builds.has(asked)) return asked;

    const name = registeredName(container, asked);
    const entry = name === undefined ? undefined : container.services[name];

    return entry === undefined || Array.isArray(entry) ? asked : entry.Class;
  }

  private async need(waiter: RunClass, asked: RunClass, path: readonly RunClass[]): Promise<void> {
    const needed = this.builtClass(asked);

    if (path.includes(needed)) throw Run.cycle(path, needed);

    const waiting = this.waitingFor(waiter, needed);

    if (waiting !== undefined) throw Run.cycle(waiting, waiter);

    this.waits.set(waiter, needed);

    try {
      await this.build(asked, path);
    } finally {
      this.waits.delete(waiter);
    }
  }

  private waitingFor(waiter: RunClass, needed: RunClass): readonly RunClass[] | undefined {
    const links: RunClass[] = [waiter];
    let at: RunClass | undefined = needed;

    while (at !== undefined && at !== waiter) {
      if (links.includes(at)) return undefined;

      links.push(at);
      at = this.waits.get(at);
    }

    return at === undefined ? undefined : links;
  }

  private async make(target: RunClass, path: readonly RunClass[]): Promise<object> {
    const { container } = this;

    if (container === undefined) {
      throw new Error(`this run was given no ${target.name} and has no container to build one`);
    }

    const { name, built, singleton } = this.registered(container, target);

    if (singleton) {
      const shared = await this.resolve(container, name);

      this.instances.set(target, shared);

      return shared;
    }

    for (const use of CapabilityUses.of(built)) await this.need(target, use.capability, path);

    this.owners.set(built, false);

    const instance = await this.resolve(container, name);

    RunScope.bind(instance, this);

    await RunScope.enter(this, () => FlowHooks.call(instance, "run"));

    this.instances.set(target, instance);

    return instance;
  }

  private registered(container: Container, target: RunClass): RegisteredClass {
    if (registeredName(container, RunGuard) === undefined) {
      throw new Error(
        `the container has no RunGuard, so a run component could be built outside a run; build the container with HarnessApplication, which registers it`,
      );
    }

    const name = registeredName(container, target);

    if (name === undefined) throw new Error(`${target.name} is not registered in the container`);

    const entry = container.services[name];

    if (entry === undefined || Array.isArray(entry)) {
      throw new Error(`${target.name} is registered as ${name} together with other classes`);
    }

    return { name, built: entry.Class, singleton: entry.singleton };
  }

  private resolve(container: Container, name: string): Promise<object> {
    const previous = Run.QUEUES.get(container) ?? Promise.resolve();

    const resolved = previous.then(() =>
      RunScope.enter(this, () => RunScope.build(name, () => container.resolve<object>(name))),
    );

    Run.QUEUES.set(
      container,
      resolved.then(
        () => undefined,
        () => undefined,
      ),
    );

    return resolved.then(
      (instance) => {
        if (instance === null || Array.isArray(instance)) throw new Error(`the container built no single ${name}`);

        return instance;
      },
      (error: unknown) => {
        throw error instanceof StartHookError ? error.cause : error;
      },
    );
  }
}

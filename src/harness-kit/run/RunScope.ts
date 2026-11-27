import { AsyncLocalStorage } from "node:async_hooks";
import type { CapabilityUse } from "../capability/types/capability.ts";
import type { Run } from "./Run.ts";

/**
 * The scope of the run that is going on: a workflow, a harness or a tool call enters it, and the `@Use` and
 * `@RunValue` fields read it. A run component reads the run that built it, wherever it is read; a tool or a flow step, a
 * singleton shared by every run, reads the run of the scope. It also tells the kit's guard which run component the
 * run is building right now.
 */
export class RunScope {
  private static readonly CURRENT = new AsyncLocalStorage<Run>();

  private static readonly BUILDING = new AsyncLocalStorage<string>();

  private static readonly OWNERS = new WeakMap<object, Run>();

  public static enter<T>(run: Run, call: () => T): T {
    return RunScope.CURRENT.run(run, call);
  }

  /** The run of the scope, or `undefined` outside every run. */
  public static find(): Run | undefined {
    return RunScope.CURRENT.getStore();
  }

  /** The run of the scope; outside every run it throws. */
  public static current(): Run {
    const run = RunScope.find();

    if (run === undefined) throw new Error("no run is open; a workflow, a harness or a tool call opens one");

    return run;
  }

  /** The registered name of the run component the run is building in this call, or `undefined`. */
  public static building(): string | undefined {
    return RunScope.BUILDING.getStore();
  }

  /** Runs `call`, the build of the run component registered as `name`, with that name as the build ticket. */
  public static build<T>(name: string, call: () => T): T {
    return RunScope.BUILDING.run(name, call);
  }

  /** Ties a run component to the run that built it, so its fields read that run wherever they are read. */
  public static bind(instance: object, run: Run): void {
    RunScope.OWNERS.set(instance, run);
  }

  public static read(owner: object, use: CapabilityUse): unknown {
    const run = RunScope.OWNERS.get(owner) ?? RunScope.find();

    if (run === undefined) throw new Error(`${owner.constructor.name}.${use.field} was read outside a run`);

    return run.read(owner, use);
  }

  public static value(owner: object, field: string, key: string): unknown {
    const run = RunScope.OWNERS.get(owner) ?? RunScope.find();

    if (run === undefined) {
      throw new Error(
        `${owner.constructor.name}.${field} reads the run value ${JSON.stringify(key)} outside a run; a run builds ${owner.constructor.name}, so take it with @Use, not @Inject`,
      );
    }

    return run.value(owner, field, key);
  }
}

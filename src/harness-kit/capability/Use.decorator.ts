import { RunScope } from "../run/RunScope.ts";
import type { RunClass } from "../run/types/run.ts";
import { CapabilityUses } from "./CapabilityUses.ts";
import type { CapabilityUse, UseOptions } from "./types/capability.ts";

/**
 * Gives a field the instance of the class `target` in the current run: a capability or another run component. A tool,
 * a flow step or a run component declares it. A capability without a scope is a singleton: every run gives the container's
 * one instance of it. Before a tool or a flow step runs, and before a run component is built, the kit
 * makes ready everything the class takes with `@Use`; the field is a getter that only reads the ready instance, so one
 * tool or flow step object serves runs with different instances. A tool's uses also give its permissions.
 *
 * How to write the field:
 * - `@Use(RepoJail) private readonly jail!: RepoJail;` The field's type is the class given to `@Use`, the field is
 *   `readonly`, has no initializer and is declared with `!`.
 * - In a tool, `@Use(RipgrepSearch, { required: false }) private readonly ripgrep: RipgrepSearch | undefined;` An
 *   optional use reads `undefined` when the run's permission group does not give the capability's permission; its
 *   type is the class `| undefined` and it has no `!`. A tool description must not promise what an optional
 *   capability does. A required use of a tool whose permission the group does not give throws `PermissionError`.
 * - The use of a flow step or of a run component is not checked against the permission group.
 * - Read the field while the run is on: inside a tool call, a flow step's `execute` or a run component of the run. A read
 *   outside a run, or of an owner the run did not make ready, throws.
 *
 * The compiler does not check these rules.
 */
export function Use(target: RunClass, options: UseOptions = {}) {
  return (owner: object, field: string | symbol): void => {
    const name = String(field);

    if (typeof target !== "function") {
      throw new Error(`@Use on the field ${name} got no class; an import cycle leaves the class undefined`);
    }

    const use: CapabilityUse = { field: name, capability: target, required: options.required !== false };

    CapabilityUses.onClass(owner.constructor, use);

    Object.defineProperty(owner, name, {
      get(this: object): unknown {
        return RunScope.read(this, use);
      },
      enumerable: true,
      configurable: false,
    });
  };
}

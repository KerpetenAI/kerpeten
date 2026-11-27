import type { Class, IocLogger } from "@asenajs/ioc";
import type { Io } from "../../cli/types/cli.ts";
import type { PermissionGroupSet } from "../../PermissionGroupSet.ts";
import type { RunClass } from "../../run/types/run.ts";
import type { KitNames } from "../KitNames.ts";

/** The type of each value the kit injects by name; a program registers its instances under these names. */
export interface KitInstances {
  readonly [KitNames.IO]: Io;
  readonly [KitNames.PERMISSION_GROUPS]: PermissionGroupSet;
}

/**
 * What a program gives the kit to build its container. `components` are the program's own classes; the kit adds its
 * own parts. `io` is where the CLI writes, the process's standard output and error when left out. `permissionGroups`
 * are the program's groups; left out, there is only the built-in group that gives every permission. `instances` are
 * the program's values the container cannot build, by the name they are injected under; `overrides` replace what is
 * registered under a name, as a test double does.
 */
export interface HarnessApplicationOptions {
  readonly components: readonly Class[];
  readonly io?: Io;
  readonly permissionGroups?: PermissionGroupSet;
  readonly instances?: Readonly<Record<string, unknown>>;
  readonly overrides?: Readonly<Record<string, object>>;
  readonly logger?: IocLogger;
}

/**
 * One way a class reaches another when a workflow starts: through `@Use`, `@Inject` or a harness's tool list. `gate` is
 * the capability of a tool's `@Use`, followed only when the run's grant gives its permission.
 */
export interface FlowEdge {
  readonly target: RunClass;
  readonly gate: RunClass | undefined;
}

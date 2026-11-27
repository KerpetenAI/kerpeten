import { ComponentConstants, type ComponentPostProcessor, getOwnTypedMetadata, PostProcessor } from "@asenajs/ioc";
import { RunScope } from "../run/RunScope.ts";
import type { RunClass } from "../run/types/run.ts";
import { KitKinds } from "./KitKinds.ts";

/**
 * Stops every build of a run component that is not the build a run asked for: a direct `resolve`, and a singleton
 * that takes a run component with `@Inject`, which stops the start. `HarnessApplication` registers it in every
 * program; a run refuses to build from a container without it.
 */
@PostProcessor("harness-kit:run-guard")
export class RunGuard implements ComponentPostProcessor {
  public postProcess<T>(instance: T, target: RunClass): T {
    if (getOwnTypedMetadata<boolean>(KitKinds.RUN, target) !== true) return instance;

    const name = getOwnTypedMetadata<string>(ComponentConstants.NameKey, target);

    if (RunScope.building() !== name) {
      throw new Error(
        `${target.name} (${String(name)}) is a run component and was built outside a run; a run builds it for the classes that take it with @Use, so take it with @Use, not @Inject, and never resolve it from the container`,
      );
    }

    return instance;
  }
}

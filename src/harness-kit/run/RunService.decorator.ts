import { defineComponent, Scope } from "@asenajs/ioc";
import { KitKinds } from "../container/KitKinds.ts";
import type { RunClass } from "./types/run.ts";

/**
 * Marks a service built once per run and registers it under `name`, like `@Service`. A tool, a flow step or another run
 * component takes it with `@Use`; it reads the values of its run with `@RunValue` and takes the program's singletons
 * with `@Inject`. Its constructor and its `@OnStart` method run inside the run, and the run awaits the latter
 * before anything reads the service; its `@OnFlowStart` methods run when a workflow that reaches it starts. A run
 * builds it; resolving it from the container or taking it with `@Inject` throws.
 */
export function RunService(name: string) {
  return (target: RunClass): void => {
    defineComponent(KitKinds.RUN, { name, scope: Scope.PROTOTYPE })(target);
  };
}

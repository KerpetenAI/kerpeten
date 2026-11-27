import { FlowHooks } from "./FlowHooks.ts";
import type { FlowStartOptions } from "./types/run.ts";

/**
 * Marks a method of a run component, a capability with `scope: "run"` or a `@RunService`, that runs when a workflow
 * starts. When a workflow starts, before its first flow step, the kit builds the marked run components the workflow
 * reaches and awaits their hooks, those of the components they take with `@Use` first. A workflow reaches what its own
 * flow steps take with `@Use` and `@Inject`, a harness's tools and what those take in turn; a tool's `@Use` whose
 * permission the run's grant does not give is not followed, and a nested workflow reaches its own when it starts.
 *
 * - `type: "run"`: the method runs once in the run. A component the run builds without a workflow start, as in a run
 *   opened by hand or for a class reached only later, runs it right after its build, so nothing uses the component
 *   before its hook ran.
 * - `type: "workflow"`: the method runs every time a workflow that reaches the component starts in the run.
 *
 * A hook that throws ends the workflow with its error before any flow step runs; a `"run"` hook that throws is a build that
 * failed and fails the run. On a class that is no run component the mark stops the container start. The method takes
 * no arguments and may return a promise.
 */
export function OnFlowStart(options: FlowStartOptions) {
  const { type } = options;

  if (type !== "run" && type !== "workflow") {
    throw new Error(`@OnFlowStart takes the type "run" or "workflow", not ${JSON.stringify(type)}`);
  }

  return (target: object, method: string | symbol): void => {
    if (typeof target === "function") {
      throw new Error(
        `@OnFlowStart marks the static method ${target.name}.${String(method)}; it marks instance methods`,
      );
    }

    FlowHooks.onClass(target.constructor, { method, type });
  };
}

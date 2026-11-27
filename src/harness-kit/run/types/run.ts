import type { Container } from "@asenajs/ioc";

/** A class a run holds an instance of: a run component, a capability, or the class of an instance given to the run. */
export type RunClass<T extends object = object> = abstract new (...args: never[]) => T;

/**
 * What a run starts with besides its grant. `values` are the first of what its components read with `@RunValue`; each
 * workflow that starts in the run adds its input. `container` builds the run components; a run without one holds only
 * the instances given to it. `test` marks the run of a test or a self-check: a harness may run in it without a
 * workflow.
 */
export interface RunSetup {
  readonly values?: object;
  readonly container?: Container;
  readonly test?: boolean;
}

/**
 * The class a container builds for a requested class, the name it is registered under and whether the container holds
 * one instance of it for the program.
 */
export interface RegisteredClass {
  readonly name: string;
  readonly built: RunClass;
  readonly singleton: boolean;
}

/** The error of the first build of a run that threw; the run cannot go on after it. */
export interface RunFailure {
  readonly error: unknown;
}

/**
 * When a flow start hook runs: `"run"` once in the run, `"workflow"` every time a workflow that reaches its component
 * starts in the run.
 */
export type FlowStartType = "run" | "workflow";

/** The options of `@OnFlowStart`. */
export interface FlowStartOptions {
  readonly type: FlowStartType;
}

/** One method marked with `@OnFlowStart`: its name and when it runs. */
export interface FlowHook {
  readonly method: string | symbol;
  readonly type: FlowStartType;
}

/** The class a flow start hook is declared on, named in the errors about its marks. */
export interface HookOwner {
  readonly name: string;
}

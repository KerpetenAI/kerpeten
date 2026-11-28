import type { Class } from "@asenajs/ioc";
import { PermissionGroupSet, Run, type RunClass, RunScope } from "@kerpetensh/harness-kit";
import { KerpetenApp } from "../../src/app/KerpetenApp.ts";
import type { StartedApp } from "../../src/app/types/app.ts";
import type { TestRunOptions } from "./types/app.ts";

const started = new Map<readonly Class[], Promise<StartedApp>>();

function container(components: readonly Class[]): Promise<StartedApp> {
  let app = started.get(components);

  if (app === undefined) {
    app = KerpetenApp.start({ io: { out: () => {}, err: () => {} }, env: {} }, components);
    started.set(components, app);
  }

  return app;
}

/** A run with `values` over a started container of the CLI's components, one container per component list. */
export async function openRun(values: object, options: TestRunOptions = {}): Promise<Run> {
  const { app } = await container(options.components ?? KerpetenApp.COMPONENTS);

  const run = new Run(options.grant ?? { group: PermissionGroupSet.ALL, every: true }, {
    values,
    container: app.container,
    test: true,
  });

  options.give?.(run);

  return run;
}

/** The ready instance of the run component `target` in a new run with `values`. */
export async function runComponent<T extends object>(
  target: RunClass<T>,
  values: object,
  options: TestRunOptions = {},
): Promise<T> {
  return (await openRun(values, options)).ready(target);
}

/** Runs `flow step` as its workflow does: in a new run with `state` as its values, after the run made the flow step ready. */
export async function runStep<S extends object, T>(
  step: { execute(state: S): T },
  state: S,
  options: TestRunOptions = {},
): Promise<Awaited<T>> {
  const run = await openRun(state, options);

  await run.prepare(step);

  return RunScope.enter(run, async (): Promise<Awaited<T>> => await step.execute(state));
}

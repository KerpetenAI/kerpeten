import { describe, expect, test } from "bun:test";
import { type Class, IocApplication } from "@asenajs/ioc";
import {
  KitNames,
  type PermissionGrant,
  PermissionGroupSet,
  Run,
  RunGuard,
  RunScope,
  Toolbox,
  type ToolOutcome,
  toolSpec,
  Use,
  WorkflowRegistry,
} from "../../../src/harness-kit/index.ts";
import { errorChain, limits, log, mockClient, quietLogger } from "../harness-kit-utils.ts";
import { Marker } from "../Marker.ts";
import { SlowTool } from "../SlowTool.ts";
import { BrokenReadHarness } from "./BrokenReadHarness.ts";
import { BrokenReadTool } from "./BrokenReadTool.ts";
import { BrokenRunWorkflow } from "./BrokenRunWorkflow.ts";
import { BrokenSource } from "./BrokenSource.ts";
import { BuildOrder } from "./BuildOrder.ts";
import { CountedService } from "./CountedService.ts";
import { CycleA } from "./CycleA.ts";
import { CycleB } from "./CycleB.ts";
import { FirstRunStep } from "./FirstRunStep.ts";
import { GrantStep } from "./GrantStep.ts";
import { InjectingService } from "./InjectingService.ts";
import { InnerRunWorkflow } from "./InnerRunWorkflow.ts";
import { KnotA } from "./KnotA.ts";
import { KnotB } from "./KnotB.ts";
import { LeafService } from "./LeafService.ts";
import { LineReader } from "./LineReader.ts";
import { LineReadTool } from "./LineReadTool.ts";
import { LineSearch } from "./LineSearch.ts";
import { LineSearchTool } from "./LineSearchTool.ts";
import { LoopService } from "./LoopService.ts";
import { LoopWatcher } from "./LoopWatcher.ts";
import { MiddleService } from "./MiddleService.ts";
import { OuterRunWorkflow } from "./OuterRunWorkflow.ts";
import { SecondRunStep } from "./SecondRunStep.ts";
import { SharedReadTool } from "./SharedReadTool.ts";
import { SharedSource } from "./SharedSource.ts";
import { SwallowingStep } from "./SwallowingStep.ts";
import { TopService } from "./TopService.ts";
import { TwinSource } from "./TwinSource.ts";
import { TwinSourceDouble } from "./TwinSourceDouble.ts";

Use(CycleA)(CycleB.prototype, "a");

Use(KnotA)(KnotB.prototype, "a");

const COMPONENTS: readonly Class[] = [
  RunGuard,
  WorkflowRegistry,
  CountedService,
  LeafService,
  MiddleService,
  TopService,
  LoopService,
  CycleA,
  CycleB,
  KnotA,
  KnotB,
  LoopWatcher,
  TwinSourceDouble,
  LineReader,
  LineSearch,
  LineSearchTool,
  LineReadTool,
  FirstRunStep,
  SecondRunStep,
  InnerRunWorkflow,
  OuterRunWorkflow,
  SharedSource,
  BrokenSource,
  BrokenReadHarness,
  SwallowingStep,
  BrokenRunWorkflow,
];

const BROKEN_READ = [
  { toolCalls: [{ name: "broken_read", input: { path: "a" } }] },
  { text: "done" },
  { text: '{"n":1}' },
] as const;

const ALL: PermissionGrant = { group: PermissionGroupSet.ALL, every: true };

const SEARCH_ONLY: PermissionGrant = { group: "search-only", every: false, permissions: ["repo:search"] };

async function started(components: readonly Class[] = COMPONENTS): Promise<IocApplication> {
  const app = await IocApplication.create({
    components: [...components],
    instances: { [KitNames.PERMISSION_GROUPS]: new PermissionGroupSet({}) },
    logger: quietLogger(),
  });

  await app.start();

  return app;
}

const app = await started();

function opened(values: object = { label: "a" }, grant: PermissionGrant = ALL): Run {
  return new Run(grant, { values, container: app.container, test: true });
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }

  throw new Error("it did not fail");
}

function outputOf(outcome: ToolOutcome): { readonly source: SharedSource; readonly label: string } {
  if (!outcome.ok) throw new Error(outcome.error);

  return outcome.output as { readonly source: SharedSource; readonly label: string };
}

function toolbox(run: Run, ...tools: Class[]): Toolbox {
  return new Toolbox(
    tools.map((tool) => ({ spec: toolSpec(tool), handler: new tool() })),
    run,
  );
}

describe("a run component", () => {
  test("is built once per run: one run gives one instance, two runs give two", async () => {
    const one = opened();
    const two = opened();

    const first = await one.ready(CountedService);

    expect(await one.ready(CountedService)).toBe(first);
    expect(await two.ready(CountedService)).not.toBe(first);
  });

  test("parallel first reads of one run build one instance", async () => {
    const run = opened();
    const built = CountedService.built;

    const instances = await Promise.all(Array.from({ length: 6 }, () => run.ready(CountedService)));

    expect(CountedService.built - built).toBe(1);
    expect(new Set(instances).size).toBe(1);
  });

  test("its @OnStart method is awaited before anything reads it, and reads the run's values", async () => {
    const counted = await opened({ label: "warm" }).ready(CountedService);

    expect(counted.warm).toBe(true);
    expect(counted.label).toBe("warm");
  });

  test("a @RunValue the run does not have throws an error that names the class, the field and the key", async () => {
    const error = await failure(() => opened({}).ready(CountedService));

    expect(errorChain(error)).toEqual([
      'CountedService.label reads the run value "label", which this run does not have',
    ]);
  });

  test("what it takes with @Use is built first, transitively", async () => {
    BuildOrder.names.length = 0;

    const top = await opened().ready(TopService);

    expect(BuildOrder.names).toEqual(["leaf", "middle", "top"]);
    expect(top.middle.leaf).toBeInstanceOf(LeafService);
  });

  test("a cycle of @Use between run components is an error that names the classes", async () => {
    expect(errorChain(await failure(() => opened().ready(CycleA)))).toEqual([
      "the run components take each other with @Use in a cycle: CycleA -> CycleB -> CycleA",
    ]);

    expect(errorChain(await failure(() => opened().ready(LoopService)))).toEqual([
      "the run components take each other with @Use in a cycle: LoopService -> LoopService",
    ]);
  });

  test("a cycle of @Use that two parallel builds close between them is the same error, not a wait without end", async () => {
    const run = opened();
    const cycle = "the run components take each other with @Use in a cycle: KnotA -> KnotB -> KnotA";

    const [a, b] = await Promise.all([failure(() => run.ready(KnotA)), failure(() => run.ready(KnotB))]);

    expect(errorChain(a)).toEqual([cycle]);
    expect(errorChain(b)).toEqual([cycle]);
  });

  test("a build that needs a component of a cycle, started beside the cycle's own build, gets the cycle's error", async () => {
    const run = opened();
    const cycle = "the run components take each other with @Use in a cycle: LoopService -> LoopService";

    const [loop, watcher] = await Promise.all([
      failure(() => run.ready(LoopService)),
      failure(() => run.ready(LoopWatcher)),
    ]);

    expect(errorChain(loop)).toEqual([cycle]);
    expect(errorChain(watcher)).toEqual([cycle]);
  });

  test("a class and the subclass registered under its name are one component of the run", async () => {
    TwinSource.built = 0;

    const run = opened();
    const [asked, registered] = await Promise.all([run.ready(TwinSource), run.ready(TwinSourceDouble)]);

    expect(asked).toBeInstanceOf(TwinSourceDouble);
    expect(asked).toBe(registered);
    expect(await run.ready(TwinSource)).toBe(registered);
    expect(TwinSource.built).toBe(1);
  });

  test("a tool's read is checked against the grant, a run component's read is not", async () => {
    const run = opened({}, SEARCH_ONLY);
    const box = toolbox(run, LineSearchTool, LineReadTool);

    expect(await box.execute("line_search", { pattern: "x" })).toEqual({ ok: true, output: "x in line of ." });

    expect(await box.execute("line_read", { path: "a" })).toEqual({
      ok: false,
      error:
        'line_read failed: LineReadTool.reader needs the capability line-reader, which the permission group "search-only" does not give',
    });
  });

  test("a field whose owner the run did not make ready throws, naming the class and the field", () => {
    const run = new Run(ALL).give(Marker, new Marker(1));

    expect(() => RunScope.enter(run, () => new SlowTool().peek())).toThrow(
      "SlowTool.marker was read before the run made SlowTool ready",
    );
  });
});

describe("a run component that cannot be built", () => {
  test("is no tool outcome: the toolbox throws the build's own error", async () => {
    const box = toolbox(opened(), BrokenReadTool);

    expect(await failure(() => box.execute("broken_read", { path: "a" }))).toBe(BrokenSource.FAILURE);
  });

  test("ends the harness run with the build's own error, and the model is not called again", async () => {
    const run = opened();
    const mock = mockClient([...BROKEN_READ]);
    const harness = await app.resolve(BrokenReadHarness);

    const error = await failure(() =>
      harness.run("request", { llm: mock.client, run, limits: limits(), now: () => 0, log }),
    );

    expect(error).toBe(BrokenSource.FAILURE);
    expect(mock.calls.length).toBe(1);
    expect(run.failure).toEqual({ error: BrokenSource.FAILURE });

    const later = mockClient([...BROKEN_READ]);

    expect(
      await failure(() => harness.run("request", { llm: later.client, run, limits: limits(), now: () => 0, log })),
    ).toBe(BrokenSource.FAILURE);

    expect(later.calls.length).toBe(0);
  });

  test("ends every parallel harness run of the run and then the workflow, also when the flow step keeps their errors", async () => {
    SwallowingStep.caught.length = 0;

    const builds = BrokenSource.builds;
    const mocks = Array.from({ length: 3 }, () => mockClient([...BROKEN_READ]));
    const workflow = await app.resolve(BrokenRunWorkflow);

    expect(await failure(() => workflow.run({ llms: mocks.map((mock) => mock.client) }))).toBe(BrokenSource.FAILURE);

    expect(SwallowingStep.caught.length).toBe(3);

    for (const caught of SwallowingStep.caught) expect(caught).toBe(BrokenSource.FAILURE);
    for (const mock of mocks) expect(mock.calls.length).toBeLessThanOrEqual(1);

    expect(BrokenSource.builds - builds).toBe(1);
  });
});

describe("a singleton capability taken with @Use", () => {
  test("is the container's one instance in every run, and each run reads it in its own scope", async () => {
    const built = SharedSource.built;
    const one = toolbox(opened({ label: "one" }), SharedReadTool);
    const two = toolbox(opened({ label: "two" }), SharedReadTool);

    const first = outputOf(await one.execute("shared_read", {}));
    const second = outputOf(await two.execute("shared_read", {}));
    const again = outputOf(await one.execute("shared_read", {}));

    expect(first.source).toBe(await app.resolve(SharedSource));
    expect(second.source).toBe(first.source);
    expect([first.label, second.label, again.label]).toEqual(["one", "two", "one"]);
    expect(SharedSource.built).toBe(built);
  });
});

describe("a flow step", () => {
  test("reads the run it is running in; outside a run that read throws, naming the flow step", () => {
    const step = new GrantStep();

    expect(RunScope.enter(opened({ label: "a" }, SEARCH_ONLY), () => step.execute({ label: "a" }))).toEqual({
      group: "search-only",
    });

    expect(() => step.execute({ label: "a" })).toThrow(
      "the flow step grant read its run outside a run; a flow step reads it only while it executes",
    );
  });
});

describe("a run without a container", () => {
  test("holds the instances it is given and refuses a class it was not given, naming it", async () => {
    const reader = new LineReader();
    const run = new Run(ALL).give(LineReader, reader);

    expect(await run.ready(LineReader)).toBe(reader);

    expect(await toolbox(run, LineReadTool).execute("line_read", { path: "a" })).toEqual({
      ok: true,
      output: "line of a",
    });

    expect(errorChain(await failure(() => run.ready(LineSearch)))).toEqual([
      "this run was given no LineSearch and has no container to build one",
    ]);

    expect(() => run.give(LineReader, reader)).toThrow("the run already has LineReader");
  });
});

describe("a workflow", () => {
  test("opens a run, and as a flow step of another workflow joins the outer run", async () => {
    const outer = await app.resolve(OuterRunWorkflow);
    const inner = await app.resolve(InnerRunWorkflow);
    const resolve = app.container.resolve;

    app.container.resolve = function <T>(this: typeof app.container, key: string) {
      if (RunScope.building() === undefined) {
        throw new Error(`only a run's build resolves after the start, and only its run components, not ${key}`);
      }

      return resolve.call(this, key) as Promise<T>;
    };

    try {
      const once = await outer.run({ label: "a" });
      const again = await outer.run({ label: "a" });
      const alone = await inner.run({ label: "a" });

      expect(once.second).toBe(once.first);
      expect(again.first).not.toBe(once.first);
      expect(alone.second).not.toBe(again.first);
    } finally {
      app.container.resolve = resolve;
    }
  });
});

describe("the start", () => {
  test("a class a flow step takes with @Use that is not registered in the container stops the start", async () => {
    const error = await failure(() => started(COMPONENTS.filter((component) => component !== CountedService)));

    expect(errorChain(error)).toEqual([
      "@OnStart hook 'WorkflowRegistry.assemble()' failed",
      [
        "the harness wiring is wrong:",
        "- flow step FirstRunStep uses CountedService in its field counted, which is not registered in the container",
        "- flow step SecondRunStep uses CountedService in its field counted, which is not registered in the container",
      ].join("\n"),
    ]);
  });
});

describe("the run guard", () => {
  test("a run component resolved from the container outside a run's build throws, naming the class", async () => {
    expect(errorChain(await failure(() => app.container.resolve("test:counted")))).toEqual([
      "CountedService (test:counted) is a run component and was built outside a run; a run builds it for the classes that take it with @Use, so take it with @Use, not @Inject, and never resolve it from the container",
    ]);
  });

  test("a singleton that takes a run component with @Inject stops the start", async () => {
    const error = await failure(() => started([...COMPONENTS, InjectingService]));

    expect(errorChain(error).join("\n")).toContain(
      "CountedService (test:counted) is a run component and was built outside a run; a run builds it for the classes that take it with @Use, so take it with @Use, not @Inject",
    );
  });

  test("a run refuses to build from a container without the guard", async () => {
    const unguarded = await started(COMPONENTS.filter((component) => component !== RunGuard));
    const run = new Run(ALL, { values: { label: "a" }, container: unguarded.container });

    expect(errorChain(await failure(() => run.ready(CountedService)))).toEqual([
      "the container has no RunGuard, so a run component could be built outside a run; build the container with HarnessApplication, which registers it",
    ]);
  });
});

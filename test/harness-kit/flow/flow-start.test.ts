import { beforeEach, describe, expect, test } from "bun:test";
import { type Class, IocApplication } from "@asenajs/ioc";
import {
  KitNames,
  OnFlowStart,
  type PermissionGrant,
  PermissionGroupError,
  PermissionGroupSet,
  Run,
  RunGuard,
  RunScope,
  WorkflowRegistry,
} from "../../../src/harness-kit/index.ts";
import { errorChain, quietLogger } from "../harness-kit-utils.ts";
import { BrokenFlowSource } from "./BrokenFlowSource.ts";
import { BrokenFlowWorkflow } from "./BrokenFlowWorkflow.ts";
import { BrokenIndexFlowStep } from "./BrokenIndexFlowStep.ts";
import { CallingStep } from "./CallingStep.ts";
import { CallingWorkflow } from "./CallingWorkflow.ts";
import { FlowIndex } from "./FlowIndex.ts";
import { FlowLockedHarness } from "./FlowLockedHarness.ts";
import { FlowLockedTool } from "./FlowLockedTool.ts";
import { FlowLog } from "./FlowLog.ts";
import { FlowSecret } from "./FlowSecret.ts";
import { FlowSecretHarness } from "./FlowSecretHarness.ts";
import { FlowSecretTool } from "./FlowSecretTool.ts";
import { FlowSource } from "./FlowSource.ts";
import { FlowWorkflow } from "./FlowWorkflow.ts";
import { HarnessFlowWorkflow } from "./HarnessFlowWorkflow.ts";
import { HarnessIndexFlowStep } from "./HarnessIndexFlowStep.ts";
import { IndexFlowStep } from "./IndexFlowStep.ts";
import { LockedFlowWorkflow } from "./LockedFlowWorkflow.ts";
import { LockedIndexFlowStep } from "./LockedIndexFlowStep.ts";
import { MisplacedFlowHook } from "./MisplacedFlowHook.ts";
import { OuterFlowWorkflow } from "./OuterFlowWorkflow.ts";
import { OuterIndexFlowStep } from "./OuterIndexFlowStep.ts";
import { StrictStep } from "./StrictStep.ts";
import { StrictWorkflow } from "./StrictWorkflow.ts";

const COMPONENTS: readonly Class[] = [
  RunGuard,
  WorkflowRegistry,
  FlowSource,
  FlowIndex,
  IndexFlowStep,
  FlowWorkflow,
  OuterIndexFlowStep,
  OuterFlowWorkflow,
  FlowSecret,
  FlowSecretTool,
  FlowSecretHarness,
  HarnessIndexFlowStep,
  HarnessFlowWorkflow,
  FlowLockedTool,
  FlowLockedHarness,
  LockedIndexFlowStep,
  LockedFlowWorkflow,
  BrokenFlowSource,
  BrokenIndexFlowStep,
  BrokenFlowWorkflow,
  CallingStep,
  CallingWorkflow,
  StrictStep,
  StrictWorkflow,
];

const ALL: PermissionGrant = { group: PermissionGroupSet.ALL, every: true };

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

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }

  throw new Error("it did not fail");
}

beforeEach(() => {
  FlowLog.clear();
});

describe("@OnFlowStart", () => {
  test("a starting workflow builds the marked run components it reaches and awaits their hooks, dependencies first, before its first flow step", async () => {
    const result = await (await app.resolve(FlowWorkflow)).run({ label: "a" });

    expect(result).toEqual({ indexed: true });

    expect(FlowLog.events).toEqual([
      "run source a",
      "workflow source",
      "run index over a",
      "workflow index",
      "flow step flow",
    ]);
  });

  test('a "run" hook runs once in the run, a "workflow" hook at every workflow start that reaches its component', async () => {
    const result = await (await app.resolve(OuterFlowWorkflow)).run({ label: "b" });

    expect(result).toEqual({ outer: true, indexed: true });

    expect(FlowLog.events).toEqual([
      "run source b",
      "workflow source",
      "flow step outer",
      "workflow source",
      "run index over b",
      "workflow index",
      "flow step flow",
    ]);
  });

  test('each run runs the "run" hooks again', async () => {
    const workflow = await app.resolve(FlowWorkflow);

    await workflow.run({ label: "one" });
    await workflow.run({ label: "two" });

    expect(FlowLog.events.filter((event) => event.startsWith("run source"))).toEqual([
      "run source one",
      "run source two",
    ]);
  });

  test("a harness's tools are reached, and a tool's @Use only when the run's grant gives its permission", async () => {
    const workflow = await app.resolve(HarnessFlowWorkflow);

    expect(await workflow.run({ permissions: ["flow:secret"] })).toBe("flow-secret");
    expect(FlowLog.events).toEqual(["run secret"]);

    FlowLog.clear();

    expect(await workflow.run({ permissions: [] })).toBe("flow-secret");
    expect(FlowLog.events).toEqual(["gap flow-secret flow_secret flow-secret flow:secret"]);
  });

  test("a hook that throws ends the workflow with its error before any flow step runs", async () => {
    const opened = BrokenFlowSource.opened;

    expect(await failure(async () => (await app.resolve(BrokenFlowWorkflow)).run({}))).toBe(BrokenFlowSource.FAILURE);

    expect(FlowLog.events).toEqual([]);
    expect(BrokenFlowSource.opened - opened).toBe(1);
  });

  test("a workflow called from a flow step reaches its own components when it starts, and its input joins the run's values", async () => {
    expect(await (await app.resolve(CallingWorkflow)).run({ inner: "c" })).toBe(true);

    expect(FlowLog.events).toEqual([
      "flow step calling",
      "run source c",
      "workflow source",
      "run index over c",
      "workflow index",
      "flow step flow",
    ]);
  });

  test("a starting workflow that brings another value for a key of the run throws an error that names the key", async () => {
    const error = await failure(async () => (await app.resolve(CallingWorkflow)).run({ inner: "c", label: "d" }));

    expect(errorChain(error)).toEqual([
      'the run already has the value "label" and a starting workflow brings another one; a workflow that joins a run may add values, not change them',
    ]);

    expect(FlowLog.events).toEqual(["flow step calling"]);
  });

  test('in a run opened by hand a "run" hook runs right after the build, once; a "workflow" hook does not run', async () => {
    const run = new Run(ALL, { values: { label: "m" }, container: app.container });
    const index = await run.ready(FlowIndex);

    expect(await run.ready(FlowIndex)).toBe(index);
    expect(await run.ready(FlowSource)).toBeInstanceOf(FlowSource);
    expect(FlowLog.events).toEqual(["run source m", "run index over m"]);
  });

  test("an instance given to the run is taken as it is, without its hooks", async () => {
    const run = new Run(ALL, { values: { label: "g" }, container: app.container }).give(FlowSource, new FlowSource());

    await run.startFlow([FlowSource]);

    expect(FlowLog.events).toEqual([]);
  });

  test("a mark on a class that is no run component stops the container start", async () => {
    const error = await failure(() => started([...COMPONENTS, MisplacedFlowHook]));

    expect(errorChain(error)).toEqual([
      "@OnStart hook 'WorkflowRegistry.assemble()' failed",
      [
        "the harness wiring is wrong:",
        '- MisplacedFlowHook.open is marked with @OnFlowStart, but MisplacedFlowHook is no run component; only a capability with scope "run" or a @RunService has flow start hooks',
      ].join("\n"),
    ]);
  });

  test("the decorator refuses a type it does not know", () => {
    expect(() => OnFlowStart({ type: "flow step" as "run" })).toThrow(
      '@OnFlowStart takes the type "run" or "workflow", not "flow step"',
    );
  });
});

describe("the grant of a run and the harnesses a workflow reaches", () => {
  test("a grant that misses a permission a reached harness cannot run without ends the workflow before anything is built", async () => {
    const workflow = await app.resolve(LockedFlowWorkflow);

    expect(await workflow.run({ permissions: ["flow:secret"] })).toBe("flow-locked");
    expect(FlowLog.events).toEqual(["run secret", "flow step locked"]);

    FlowLog.clear();

    const refused = await failure(() => workflow.run({ permissions: [] }));

    expect(refused).toBeInstanceOf(PermissionGroupError);

    expect((refused as Error).message).toBe(
      [
        'the permission group "given" cannot start this run:',
        "- harness flow-locked needs the permission flow:secret",
      ].join("\n"),
    );

    expect(FlowLog.events).toEqual([]);
  });

  test("a workflow that joins a run is checked against its own harnesses, not against every harness of the container", async () => {
    const run = new Run({ group: "given", every: false, permissions: [] }, { container: app.container });
    const flow = await app.resolve(FlowWorkflow);
    const locked = await app.resolve(LockedFlowWorkflow);

    expect(await RunScope.enter(run, () => flow.run({ label: "c" }))).toEqual({ indexed: true });

    expect(await failure(() => RunScope.enter(run, () => locked.run({ permissions: [] })))).toBeInstanceOf(
      PermissionGroupError,
    );

    expect(FlowLog.events.includes("flow step locked")).toBe(false);
  });
});

describe("a workflow's admit and rescue", () => {
  test("admit checks the run's grant before the flow steps; rescue turns the error into the result", async () => {
    const workflow = await app.resolve(StrictWorkflow);

    expect(await workflow.run({ group: "kept" })).toBe("passed");
    expect(await workflow.run({ group: "refused" })).toBe("rescued in group refused: the group refused is refused");

    expect(await workflow.run({ group: "kept", crash: true })).toBe(
      "rescued in group kept: the strict flow step crashed",
    );
  });

  test("admit checks the grant of a run the workflow joins", async () => {
    const run = new Run({ group: "refused", every: true }, { container: app.container });
    const workflow = await app.resolve(StrictWorkflow);

    expect(await RunScope.enter(run, () => workflow.run({ group: "kept" }))).toBe(
      "rescued in group kept: the group refused is refused",
    );
  });
});

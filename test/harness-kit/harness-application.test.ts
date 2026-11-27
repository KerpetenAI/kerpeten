import { describe, expect, test } from "bun:test";
import {
  CapabilityRegistry,
  HarnessApplication,
  HarnessRegistry,
  harnessSpec,
  type KitInstances,
  KitNames,
  PermissionGroupError,
  PermissionGroupSet,
  RunGuard,
  WiringError,
  WorkflowRegistry,
} from "../../src/harness-kit/index.ts";
import { Builds } from "./Builds.ts";
import { FlowLockedHarness } from "./flow/FlowLockedHarness.ts";
import { FlowLockedTool } from "./flow/FlowLockedTool.ts";
import { FlowSecret } from "./flow/FlowSecret.ts";
import { GroupedFlowWorkflow } from "./flow/GroupedFlowWorkflow.ts";
import { LockedIndexFlowStep } from "./flow/LockedIndexFlowStep.ts";
import { quietLogger } from "./harness-kit-utils.ts";
import { Marker } from "./Marker.ts";
import { SearchCapability } from "./SearchCapability.ts";
import { SecondStampHarness } from "./SecondStampHarness.ts";
import { StampHarness } from "./StampHarness.ts";
import { StampTool } from "./StampTool.ts";

const groups = new PermissionGroupSet({ marked: ["marker:read"], searching: ["marker:read", "repo:search"] });
const PROGRAM = [StampHarness, SecondStampHarness, StampTool, Marker, SearchCapability];

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }

  throw new Error("it did not fail");
}

describe("a program on the kit", () => {
  test("lists only its own components; the kit registers its parts and its two values itself", async () => {
    const app = await HarnessApplication.create({
      components: PROGRAM,
      permissionGroups: groups,
      logger: quietLogger(),
    });

    await app.start();

    const registry = await app.resolve(HarnessRegistry);

    expect(registry.harnesses.map((harness) => harnessSpec(harness).name)).toEqual(
      [StampHarness, SecondStampHarness].map((harness) => harnessSpec(harness).name).sort(),
    );

    for (const part of HarnessApplication.PARTS) expect(await app.resolve(part)).toBeInstanceOf(part);

    expect(await app.resolve<KitInstances[KitNames.PERMISSION_GROUPS]>(KitNames.PERMISSION_GROUPS)).toBe(groups);
    expect(typeof (await app.resolve<KitInstances[KitNames.IO]>(KitNames.IO)).out).toBe("function");
    expect(await app.stop()).toBe(0);
  });

  test("without permission groups there is only the built-in group that gives every permission", async () => {
    const app = await HarnessApplication.create({ components: [Marker], logger: quietLogger() });
    const set = await app.resolve<KitInstances[KitNames.PERMISSION_GROUPS]>(KitNames.PERMISSION_GROUPS);

    expect(set.declared).toEqual([]);
    expect(set.grant(PermissionGroupSet.ALL)).toEqual({ group: PermissionGroupSet.ALL, every: true });
  });

  test("the capability registry tells the registered capabilities by name without building a run capability", async () => {
    const app = await HarnessApplication.create({
      components: PROGRAM,
      permissionGroups: groups,
      logger: quietLogger(),
    });

    await app.start();

    const built = Builds.made.length;
    const specs = (await app.resolve(CapabilityRegistry)).specs;

    expect(specs.map((spec) => [spec.name, spec.permission])).toEqual([
      ["marker", "marker:read"],
      ["search", "repo:search"],
    ]);

    expect(specs[1]?.description).toBe("Finds a pattern.");
    expect(Builds.made.length).toBe(built);
  });

  test("a workflow opens its run with the permission group it names, every permission when it names none", async () => {
    const app = await HarnessApplication.create({
      components: [FlowSecret, FlowLockedTool, FlowLockedHarness, LockedIndexFlowStep, GroupedFlowWorkflow],
      permissionGroups: new PermissionGroupSet({ secret: ["flow:secret"] }),
      logger: quietLogger(),
    });

    await app.start();

    const workflow = await app.resolve(GroupedFlowWorkflow);

    expect(await workflow.run({ permissions: [], group: "secret" })).toBe("flow-locked");
    expect(await workflow.run({ permissions: [] })).toBe("flow-locked");

    const unknown = await failure(() => workflow.run({ permissions: [], group: "nobody" }));

    expect(unknown).toBeInstanceOf(PermissionGroupError);
    expect((unknown as Error).message).toContain('unknown permission group "nobody"');
  });

  test("a program that lists a part of the kit is refused", async () => {
    const error = await failure(() =>
      HarnessApplication.create({ components: [RunGuard, ...PROGRAM, WorkflowRegistry], logger: quietLogger() }),
    );

    expect((error as Error).message).toBe(
      "the component list holds RunGuard, WorkflowRegistry, which the kit registers itself; leave it out",
    );
  });

  test("an instance under one of the kit's names is refused", async () => {
    const error = await failure(() =>
      HarnessApplication.create({
        components: PROGRAM,
        instances: { [KitNames.PERMISSION_GROUPS]: groups },
        logger: quietLogger(),
      }),
    );

    expect((error as Error).message).toBe(
      "the instances hold harness-kit:permission-groups, which the kit registers itself; give the io and the permission groups as options",
    );
  });

  test("a program without a component is refused", async () => {
    expect(((await failure(() => HarnessApplication.create({ components: [] }))) as Error).message).toBe(
      "the program lists no component",
    );
  });

  test("a start hook that fails throws its own error", async () => {
    const app = await HarnessApplication.create({
      components: [StampHarness, Marker, SearchCapability],
      permissionGroups: groups,
      logger: quietLogger(),
    });

    expect(await failure(() => app.start())).toBeInstanceOf(WiringError);
  });
});

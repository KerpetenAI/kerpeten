import { describe, expect, test } from "bun:test";
import { type Class, IocApplication } from "@asenajs/ioc";
import {
  HarnessRegistry,
  HarnessWiring,
  KitNames,
  PermissionGroupSet,
  Run,
  WiringError,
} from "../../src/harness-kit/index.ts";
import { errorChain, limits, log, mockClient, quietLogger } from "./harness-kit-utils.ts";
import { Marker } from "./Marker.ts";
import { SearchCapability } from "./SearchCapability.ts";
import { SecondStampHarness } from "./SecondStampHarness.ts";
import { StampHarness } from "./StampHarness.ts";
import { StampTool } from "./StampTool.ts";

const groups = new PermissionGroupSet({ marked: ["marker:read"], searching: ["marker:read", "repo:search"] });

async function started(components: readonly Class[]): Promise<IocApplication> {
  const app = await IocApplication.create({
    components: [HarnessRegistry, ...components],
    instances: { [KitNames.PERMISSION_GROUPS]: groups },
    logger: quietLogger(),
  });

  await app.start();

  return app;
}

async function startFailure(components: readonly Class[]): Promise<unknown> {
  try {
    await started(components);
  } catch (error) {
    return error;
  }

  throw new Error("the start did not fail");
}

describe("tools and harnesses as container singletons", () => {
  test("each tool is built once, the harnesses share it, and 40 interleaved runs with different groups each read only their own capabilities", async () => {
    const harnesses = [StampHarness, SecondStampHarness];
    const built = StampTool.built;
    const app = await started([...harnesses, StampTool, Marker, SearchCapability]);
    const stamper = await app.resolve(StampHarness);
    const second = await app.resolve(SecondStampHarness);

    expect(StampTool.built - built).toBe(1);

    app.container.resolve = () => {
      throw new Error("nothing may be resolved after the start");
    };

    StampTool.stamps.length = 0;

    const runs = Array.from({ length: 40 }, (_, index) => ({
      harness: index % 2 === 0 ? stamper : second,
      group: index % 3 === 0 ? "marked" : "searching",
      waitMs: (index * 7) % 13,
      index,
    }));

    expect(HarnessWiring.admit(harnesses, groups.grant("marked")).map((gap) => gap.permission)).toEqual([
      "repo:search",
      "repo:search",
    ]);

    const results = await Promise.all(
      runs.map(({ harness, group, waitMs, index }) =>
        harness.run("request", {
          llm: mockClient([
            { toolCalls: [{ name: "stamp", input: { waitMs } }] },
            { text: "done" },
            { text: '{"n":1}' },
          ]).client,
          run: new Run(groups.grant(group), { test: true })
            .give(Marker, new Marker(index))
            .give(SearchCapability, new SearchCapability()),
          limits: limits(),
          now: () => 0,
          log,
        }),
      ),
    );

    expect(results.map((result) => result.value)).toEqual(runs.map(() => ({ n: 1 })));

    expect([...StampTool.stamps].sort((a, b) => a.before - b.before)).toEqual(
      runs.map(({ index, group }) => ({ before: index, after: index, searched: group === "searching" })),
    );

    expect(StampTool.built - built).toBe(1);
  });

  test("a capability a tool takes with @Use that is not registered in the container stops the start", async () => {
    const error = await startFailure([StampHarness, StampTool, Marker]);

    expect(errorChain(error)).toEqual([
      "@OnStart hook 'HarnessRegistry.assemble()' failed",
      "the harness wiring is wrong:\n- tool stamp uses SearchCapability in its field searcher, which is not registered in the container",
    ]);

    expect((error as Error).cause).toBeInstanceOf(WiringError);
  });

  test("a tool a harness lists that is not registered in the container stops the start", async () => {
    const error = await startFailure([StampHarness]);

    expect(errorChain(error)).toEqual([
      "@OnStart hook 'HarnessRegistry.assemble()' failed",
      "the harness wiring is wrong:\n- harness stamper lists StampTool, which is not registered in the container",
    ]);

    expect((error as Error).cause).toBeInstanceOf(WiringError);
  });
});

import { type Container, ICoreServiceNames, Inject, OnStart, Service } from "@asenajs/ioc";
import { harnessSpec } from "../Harness.decorator.ts";
import type { HarnessBase } from "../HarnessBase.ts";
import { HarnessWiring } from "../HarnessWiring.ts";
import { toolSpec } from "../Tool.decorator.ts";
import type { HarnessClass } from "../types/harness.ts";
import type { BoundTool, ToolClass, ToolHandler } from "../types/tool.ts";
import { WiringError } from "../WiringError.ts";
import { registeredName, unregisteredUses } from "./container-utils.ts";
import { KitKinds } from "./KitKinds.ts";
import { KitNames } from "./KitNames.ts";
import type { KitInstances } from "./types/container.ts";

/**
 * Checks the wiring of the container's harnesses and the permission groups when the container starts, then gives each
 * harness its tool singletons. A class a tool takes with `@Use`, or a run component takes in turn, that is not
 * registered in the container stops the start. Everything is resolved here, one after another; after the start only a
 * run resolves: its run components, and the singletons they take with `@Use` as the container holds them. After the
 * start it also tells the classes of the container's harnesses.
 */
@Service("harness-kit:harness-registry")
export class HarnessRegistry {
  @Inject(ICoreServiceNames.CONTAINER)
  private readonly container!: Container;

  @Inject(KitNames.PERMISSION_GROUPS)
  private readonly groups!: KitInstances[KitNames.PERMISSION_GROUPS];

  private classes: readonly HarnessClass[] | undefined;

  /** The classes of the container's harnesses, sorted by harness name; read before the container started, it throws. */
  public get harnesses(): readonly HarnessClass[] {
    if (this.classes === undefined) {
      throw new Error("the harness classes are read before the container started its HarnessRegistry");
    }

    return this.classes;
  }

  @OnStart()
  public async assemble(): Promise<void> {
    const harnesses = (await this.container.resolveAll<HarnessBase>(KitKinds.HARNESS)).flat();
    const classes = harnesses.map((harness) => harness.constructor as HarnessClass);

    HarnessWiring.check(classes, this.groups);

    const problems: string[] = [];
    const tools = new Map<ToolClass, BoundTool>();
    const ready: [HarnessBase, readonly BoundTool[]][] = [];

    for (const harness of harnesses) {
      const bound: BoundTool[] = [];

      for (const tool of harness.spec.tools) {
        const name = registeredName(this.container, tool);

        if (name === undefined) {
          problems.push(`harness ${harness.spec.name} lists ${tool.name}, which is not registered in the container`);
          continue;
        }

        let made = tools.get(tool);

        if (made === undefined) {
          const spec = toolSpec(tool);

          problems.push(...unregisteredUses(this.container, tool, `tool ${spec.name}`));
          made = { spec, handler: (await this.container.resolve(name)) as ToolHandler };
          tools.set(tool, made);
        }

        bound.push(made);
      }

      ready.push([harness, bound]);
    }

    if (problems.length > 0) throw new WiringError(problems);

    for (const [harness, bound] of ready) harness.bind(bound);

    this.classes = HarnessRegistry.byName(classes);
  }

  private static byName(classes: readonly HarnessClass[]): readonly HarnessClass[] {
    const named = classes.map((harness) => ({ harness, name: harnessSpec(harness).name }));

    named.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    return named.map((entry) => entry.harness);
  }
}

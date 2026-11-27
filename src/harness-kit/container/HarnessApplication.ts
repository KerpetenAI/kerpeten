import { type Class, type Container, IocApplication, StartHookError } from "@asenajs/ioc";
import type { Io } from "../cli/types/cli.ts";
import { PermissionGroupSet } from "../PermissionGroupSet.ts";
import { CapabilityRegistry } from "./CapabilityRegistry.ts";
import { HarnessRegistry } from "./HarnessRegistry.ts";
import { KitNames } from "./KitNames.ts";
import { RunGuard } from "./RunGuard.ts";
import type { HarnessApplicationOptions } from "./types/container.ts";
import { WorkflowRegistry } from "./WorkflowRegistry.ts";

/**
 * A program on the kit: an `@asenajs/ioc` container that the kit sets up. The kit registers its own parts itself,
 * `RunGuard`, `HarnessRegistry`, `WorkflowRegistry` and `CapabilityRegistry`, and its two values, the io and the
 * permission groups, which the program gives as options. The program lists only its own components and gives the
 * values the container cannot build as `instances`.
 *
 * A program that lists one of the kit's parts among its components, or registers an instance under one of the kit's
 * names, is refused.
 */
export class HarnessApplication {
  /** The kit's own components, registered in every program. */
  public static readonly PARTS: readonly Class[] = [RunGuard, HarnessRegistry, WorkflowRegistry, CapabilityRegistry];

  private static readonly PROCESS_IO: Io = {
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };

  private readonly app: IocApplication;

  private constructor(app: IocApplication) {
    this.app = app;
  }

  /** Builds the container: the program's components and the kit's parts. Nothing is started yet. */
  public static async create(options: HarnessApplicationOptions): Promise<HarnessApplication> {
    const { components, instances = {}, overrides, logger } = options;

    if (components.length === 0) throw new Error("the program lists no component");

    const parts = components.filter((component) => HarnessApplication.PARTS.includes(component));

    if (parts.length > 0) {
      throw new Error(
        `the component list holds ${parts.map((part) => part.name).join(", ")}, which the kit registers itself; leave it out`,
      );
    }

    const taken = Object.values(KitNames).filter((name) => Object.hasOwn(instances, name));

    if (taken.length > 0) {
      throw new Error(
        `the instances hold ${taken.join(", ")}, which the kit registers itself; give the io and the permission groups as options`,
      );
    }

    const app = await IocApplication.create({
      components: [...components],
      imports: [HarnessApplication.PARTS],
      instances: {
        ...instances,
        [KitNames.IO]: options.io ?? HarnessApplication.PROCESS_IO,
        [KitNames.PERMISSION_GROUPS]: options.permissionGroups ?? new PermissionGroupSet({}),
      },
      ...(overrides === undefined ? {} : { overrides: { ...overrides } }),
      ...(logger === undefined ? {} : { logger }),
    });

    return new HarnessApplication(app);
  }

  public get container(): Container {
    return this.app.container;
  }

  public resolve<T>(key: string | Class<T>): Promise<T> {
    return this.app.resolve(key);
  }

  /** Runs the start hooks. One that fails throws its own error, without the container's `StartHookError` around it. */
  public async start(): Promise<void> {
    try {
      await this.app.start();
    } catch (error) {
      throw error instanceof StartHookError ? error.cause : error;
    }
  }

  /** Runs the stop hooks and tells how many of them failed. */
  public stop(): Promise<number> {
    return this.app.stop();
  }
}

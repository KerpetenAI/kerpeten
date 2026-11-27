import { type Container, ICoreServiceNames, Inject, Service } from "@asenajs/ioc";
import { capabilitySpec } from "../capability/Capability.decorator.ts";
import type { CapabilitySpec } from "../capability/types/capability.ts";
import { UnmarkedClassError } from "../UnmarkedClassError.ts";

/**
 * Tells the capabilities registered in the container. It reads what `@Capability` put on each class, so it builds no
 * capability: one with `scope: "run"` is listed like every other, outside any run.
 */
@Service("harness-kit:capability-registry")
export class CapabilityRegistry {
  @Inject(ICoreServiceNames.CONTAINER)
  private readonly container!: Container;

  /** The spec of every capability registered in the container, sorted by capability name. */
  public get specs(): readonly CapabilitySpec[] {
    const specs: CapabilitySpec[] = [];

    for (const entry of Object.values(this.container.services)) {
      for (const service of [entry].flat()) {
        const spec = CapabilityRegistry.spec(service.Class);

        if (spec !== undefined) specs.push(spec);
      }
    }

    return specs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  private static spec(target: object): CapabilitySpec | undefined {
    try {
      return capabilitySpec(target);
    } catch (error) {
      if (error instanceof UnmarkedClassError) return undefined;

      throw error;
    }
  }
}

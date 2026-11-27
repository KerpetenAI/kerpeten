import { ComponentConstants, type Container, getOwnTypedMetadata } from "@asenajs/ioc";
import { CapabilityUses } from "../capability/CapabilityUses.ts";

/** The name the class is registered under in the container; `undefined` when it is not a component of the container. */
export function registeredName(container: Container, target: object): string | undefined {
  const name = getOwnTypedMetadata<string>(ComponentConstants.NameKey, target);

  return name !== undefined && container.has(name) ? name : undefined;
}

/**
 * Every class that `owner` takes with `@Use`, and through those every class a run component takes in turn, that is
 * not registered in the container, as one problem each. `label` names the owner in its problems, like `tool grep`.
 */
export function unregisteredUses(container: Container, owner: object, label: string): readonly string[] {
  const problems: string[] = [];
  const seen = new Set<object>();

  const visit = (holder: object, name: string): void => {
    for (const use of CapabilityUses.of(holder)) {
      if (registeredName(container, use.capability) === undefined) {
        problems.push(
          `${name} uses ${use.capability.name} in its field ${use.field}, which is not registered in the container`,
        );

        continue;
      }

      if (seen.has(use.capability)) continue;

      seen.add(use.capability);
      visit(use.capability, use.capability.name);
    }
  };

  visit(owner, label);

  return problems;
}

import { defineComponent } from "@asenajs/ioc";
import { ClassMetadata } from "./ClassMetadata.ts";
import { KitKinds } from "./container/KitKinds.ts";
import type { HarnessBase } from "./HarnessBase.ts";
import { isPermission } from "./harness-kit-utils.ts";
import type { HarnessSpec } from "./types/harness.ts";

const SPECS = new ClassMetadata<HarnessSpec>("Harness");

/** Marks a harness and registers it as a container component named `harness:<name>`. */
export function Harness(spec: HarnessSpec) {
  const { name, permissions } = spec;

  if (!Array.isArray(permissions)) throw new Error(`harness ${name} needs a permissions list`);

  const seen = new Set<string>();

  for (const permission of permissions) {
    if (!isPermission(permission)) {
      throw new Error(
        `harness ${name} lists the permission ${JSON.stringify(permission)}; a permission is lowercase words joined by colons, like repo:read`,
      );
    }

    if (seen.has(permission)) throw new Error(`harness ${name} lists the permission ${permission} twice`);

    seen.add(permission);
  }

  return (target: abstract new (...args: never[]) => HarnessBase): void => {
    SPECS.set(target, spec);
    defineComponent(KitKinds.HARNESS, `harness:${name}`)(target);
  };
}

export function harnessSpec(target: object): HarnessSpec {
  return SPECS.get(target);
}

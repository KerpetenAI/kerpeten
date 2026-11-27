import { defineComponent, Scope } from "@asenajs/ioc";
import { ClassMetadata } from "../ClassMetadata.ts";
import { KitKinds } from "../container/KitKinds.ts";
import { isPermission } from "../harness-kit-utils.ts";
import type { CapabilityClass, CapabilitySpec } from "./types/capability.ts";

const SPECS = new ClassMetadata<CapabilitySpec>("Capability");

/**
 * Marks a capability and registers it as a container component named `capability:<name>`. With `scope: "run"` it is
 * a run component: a run builds it once, for the tools, flow steps and run components that take it with `@Use`, and it
 * reads the values of its run with `@RunValue`. Without a scope it is a singleton of the program, and a class that takes
 * it with `@Use` gets that one instance in every run.
 */
export function Capability(spec: CapabilitySpec) {
  const { permission } = spec;

  if (permission !== undefined && !isPermission(permission)) {
    throw new Error(
      `capability ${spec.name} declares the permission ${JSON.stringify(permission)}; a permission is lowercase words joined by colons, like repo:read`,
    );
  }

  return (target: CapabilityClass): void => {
    const inherited = SPECS.find(Object.getPrototypeOf(target) as object);

    if (inherited !== undefined && inherited.permission !== permission) {
      throw new Error(
        `capability ${spec.name} extends ${inherited.name} and must declare the same permission (${inherited.permission ?? "none"}), not ${permission ?? "none"}`,
      );
    }

    SPECS.set(target, spec);

    const name = `capability:${spec.name}`;

    if (spec.scope === "run") defineComponent(KitKinds.RUN, { name, scope: Scope.PROTOTYPE })(target);
    else defineComponent(KitKinds.CAPABILITY, name)(target);
  };
}

/** The spec of a capability class: its own, or that of its nearest marked base class, as for a test double. */
export function capabilitySpec(target: object): CapabilitySpec {
  return SPECS.nearest(target);
}

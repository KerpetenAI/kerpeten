import { defineComponent } from "@asenajs/ioc";
import { ClassMetadata } from "../ClassMetadata.ts";
import { KitKinds } from "../container/KitKinds.ts";
import type { CliBase } from "./CliBase.ts";
import type { CliSpec } from "./types/cli.ts";

const SPECS = new ClassMetadata<CliSpec>("CLI");

/**
 * Marks a CLI and registers it as a container component named `cli:<name>`; its `commands` list names its commands, in
 * order.
 */
export function CLI(spec: CliSpec) {
  return (target: abstract new () => CliBase): void => {
    SPECS.set(target, spec);
    defineComponent(KitKinds.CLI, `cli:${spec.name}`)(target);
  };
}

export function cliSpec(target: object): CliSpec {
  return SPECS.get(target);
}

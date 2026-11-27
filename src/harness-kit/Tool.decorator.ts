import { defineComponent } from "@asenajs/ioc";
import { z } from "zod";
import { ClassMetadata } from "./ClassMetadata.ts";
import { CapabilityUses } from "./capability/CapabilityUses.ts";
import { KitKinds } from "./container/KitKinds.ts";
import { ToolError } from "./ToolError.ts";
import type { ToolDeclaration, ToolHandler, ToolSpec } from "./types/tool.ts";

const SPECS = new ClassMetadata<ToolSpec>("Tool");

/** Marks a tool and registers it as a container component named `tool:<name>`. */
export function Tool<S extends z.ZodType>(spec: ToolDeclaration<S>) {
  return (target: new () => ToolHandler<S>): void => {
    const run = target.prototype.execute as (input: z.infer<S>) => unknown;

    target.prototype.execute = function (this: ToolHandler<S>, raw: unknown): unknown {
      const parsed = spec.input.safeParse(raw);

      if (!parsed.success) throw new ToolError(`invalid input for ${spec.name}: ${z.prettifyError(parsed.error)}`);

      return run.call(this, parsed.data);
    };

    SPECS.set(target, { ...spec, uses: CapabilityUses.of(target) });
    defineComponent(KitKinds.TOOL, `tool:${spec.name}`)(target);
  };
}

export function toolSpec(target: object): ToolSpec {
  return SPECS.get(target);
}

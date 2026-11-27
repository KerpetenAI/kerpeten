import type { z } from "zod";
import type { CapabilityUse } from "../capability/types/capability.ts";

export interface ToolDeclaration<S extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly input: S;
}

/** A tool's declaration and the capabilities its `@Use` fields use, base class fields first. */
export interface ToolSpec<S extends z.ZodType = z.ZodType> extends ToolDeclaration<S> {
  readonly uses: readonly CapabilityUse[];
}

export interface ToolHandler<S extends z.ZodType = z.ZodType> {
  execute(input: z.infer<S>): unknown;
}

export interface BoundTool {
  readonly spec: ToolSpec;
  readonly handler: ToolHandler;
}

export type ToolClass<S extends z.ZodType = z.ZodType> = new () => ToolHandler<S>;

export type ToolOutcome =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly error: string };

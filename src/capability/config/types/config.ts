import type { z } from "zod";
import type { configSchema } from "../schemas/config-schema.ts";

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type KerpetenConfig = DeepReadonly<z.infer<typeof configSchema>>;

export type ModelConfig = KerpetenConfig["models"]["reviewer"];

export type KeyModelConfig = Exclude<ModelConfig, { readonly provider: "chatgpt" }>;

export type ChatGptModelConfig = Extract<ModelConfig, { readonly provider: "chatgpt" }>;

export type ConfigResult =
  | { readonly ok: true; readonly config: KerpetenConfig; readonly hash: string }
  | { readonly ok: false; readonly errors: readonly string[] };

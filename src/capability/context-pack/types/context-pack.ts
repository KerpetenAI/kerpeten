import type { z } from "zod";
import type { contextPackSchema } from "../schemas/context-pack-schema.ts";

export type ContextPack = z.infer<typeof contextPackSchema>;

export type ContextFileResult =
  | { readonly ok: true; readonly pack: ContextPack }
  | { readonly ok: false; readonly error: string };

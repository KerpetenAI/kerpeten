import type { z } from "zod";
import type { globInput } from "../schemas/glob-schema.ts";

export type GlobInput = z.infer<typeof globInput>;

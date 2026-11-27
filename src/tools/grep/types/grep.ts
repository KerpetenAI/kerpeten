import type { z } from "zod";
import type { grepInput } from "../schemas/grep-schema.ts";

export type GrepInput = z.infer<typeof grepInput>;

export interface GrepMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

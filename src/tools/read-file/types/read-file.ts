import type { z } from "zod";
import type { readFileInput } from "../schemas/read-file-schema.ts";

export type ReadFileInput = z.infer<typeof readFileInput>;

export interface PageTail {
  readonly first: number;
  readonly lines: string[];
}

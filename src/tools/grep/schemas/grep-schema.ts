import { z } from "zod";
import { toolPath } from "../../schemas/tool-input-schema.ts";

export const grepInput = z.strictObject({
  pattern: z.string().min(1).max(1024),
  path: toolPath.optional(),
  case_insensitive: z.boolean().optional(),
  fixed_strings: z.boolean().optional(),
});

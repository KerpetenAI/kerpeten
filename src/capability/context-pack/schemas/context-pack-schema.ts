import { z } from "zod";

export const contextPackSchema = z.object({
  known: z.array(z.object({ title: z.string(), file: z.string(), reason: z.string().optional() })),
});

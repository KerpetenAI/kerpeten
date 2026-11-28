import { z } from "zod";

export const readInput = z.object({ path: z.string().optional() });

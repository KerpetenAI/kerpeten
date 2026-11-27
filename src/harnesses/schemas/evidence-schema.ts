import { z } from "zod";

export const evidence = z.strictObject({ location: z.string(), note: z.string().optional() });

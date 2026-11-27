import { z } from "zod";

export const readInput = z.strictObject({ path: z.string().min(1) });

export const runInput = z.strictObject({ command: z.string().min(1) });

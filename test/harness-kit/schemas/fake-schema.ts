import { z } from "zod";

export const readInput = z.object({ path: z.string().optional() });

export const listInput = z.strictObject({ path: z.string() });

export const grepInput = z.strictObject({ pattern: z.string() });

export const testOutput = z.object({ n: z.int() });

export const slowInput = z.strictObject({ waitMs: z.int().min(0), file: z.string() });

export const emptyInput = z.strictObject({});

export const stampInput = z.strictObject({ waitMs: z.int().min(0) });

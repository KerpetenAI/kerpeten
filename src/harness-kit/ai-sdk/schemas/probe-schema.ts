import { z } from "zod";

export const probeInput = z.strictObject({});

export const probeOutput = z.strictObject({ ok: z.literal(true) });

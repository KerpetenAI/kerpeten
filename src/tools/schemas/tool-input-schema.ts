import { z } from "zod";

export const toolPath = z.string().min(1).max(4096);

export const lineNumber = z.int().min(1).max(2_147_483_647);

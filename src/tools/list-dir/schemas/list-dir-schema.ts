import { z } from "zod";
import { toolPath } from "../../schemas/tool-input-schema.ts";

export const listDirInput = z.strictObject({ path: toolPath.optional() });

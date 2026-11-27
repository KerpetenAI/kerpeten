import { z } from "zod";
import { lineNumber, toolPath } from "../../schemas/tool-input-schema.ts";

export const readFileInput = z.strictObject({
  path: toolPath,
  start_line: lineNumber.optional(),
  end_line: lineNumber.optional(),
});

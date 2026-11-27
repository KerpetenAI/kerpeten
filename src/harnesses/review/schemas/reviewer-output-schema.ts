import { z } from "zod";
import type { Finding } from "../../../api/types/api.generated.ts";
import { lineNumber } from "../../../tools/schemas/tool-input-schema.ts";
import { evidence } from "../../schemas/evidence-schema.ts";

const CATEGORIES = [
  "bug",
  "security",
  "concurrency",
  "error_handling",
  "contract",
  "performance",
] as const satisfies readonly Finding["category"][];

export const reviewerFinding = z.strictObject({
  file: z.string(),
  start_line: lineNumber,
  end_line: lineNumber,
  category: z.enum(CATEGORIES),
  title: z.string(),
  body: z.string(),
  evidence: z.array(evidence).min(1),
});

export const reviewerOutput = z.strictObject({ findings: z.array(reviewerFinding) });

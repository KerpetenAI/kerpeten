import { z } from "zod";
import type { Finding } from "../../../api/types/api.generated.ts";
import { lineNumber } from "../../../tools/schemas/tool-input-schema.ts";
import { evidence } from "../../schemas/evidence-schema.ts";

const BACKEND_CATEGORIES = [
  "bug",
  "security",
  "concurrency",
  "error_handling",
  "contract",
  "performance",
] as const satisfies readonly Finding["category"][];

const CATEGORIES_NOT_IN_BACKEND = ["convention"] as const;

export const reviewerFinding = z.strictObject({
  file: z.string(),
  start_line: lineNumber,
  end_line: lineNumber,
  category: z.enum([...BACKEND_CATEGORIES, ...CATEGORIES_NOT_IN_BACKEND]),
  title: z.string(),
  body: z.string(),
  evidence: z.array(evidence).min(1),
});

export const reviewerOutput = z.strictObject({ findings: z.array(reviewerFinding) });

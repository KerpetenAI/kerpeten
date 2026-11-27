import { z } from "zod";
import type { Finding } from "../../../api/types/api.generated.ts";
import { evidence } from "../../schemas/evidence-schema.ts";

const VERDICTS = ["verified", "unverified", "refuted"] as const satisfies readonly NonNullable<Finding["verdict"]>[];

const PRIORITIES = ["P0", "P1", "P2"] as const satisfies readonly NonNullable<Finding["priority"]>[];

const NATURES = ["critical", "edge_case"] as const satisfies readonly NonNullable<Finding["nature"]>[];

const FIX_EFFORTS = ["easy", "hard"] as const satisfies readonly NonNullable<Finding["fix_effort"]>[];

export const judgeOutput = z.strictObject({
  verdict: z.enum(VERDICTS),
  priority: z.enum(PRIORITIES),
  nature: z.enum(NATURES),
  fix_effort: z.enum(FIX_EFFORTS),
  rationale: z.string().refine((text) => text.trim() !== "", "the rationale is empty"),
  evidence: z.array(evidence).min(1),
});

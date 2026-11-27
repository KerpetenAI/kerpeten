import type { Finding } from "../../../api/types/api.generated.ts";
import type { KerpetenConfig } from "../../../capability/config/types/config.ts";

export interface JudgeLabels {
  readonly verdict: NonNullable<Finding["verdict"]>;
  readonly priority: NonNullable<Finding["priority"]>;
  readonly nature: NonNullable<Finding["nature"]>;
  readonly fix_effort: NonNullable<Finding["fix_effort"]>;
}

export type ScoredAction = Extract<Finding["action"], "inline" | "summary" | "stored">;

export interface Scored {
  readonly score: number;
  readonly action: ScoredAction;
}

export type ScoringConfig = Pick<KerpetenConfig, "scoring" | "thresholds">;

export type WeightTable = Readonly<Record<string, number>>;

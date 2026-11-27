import { Service } from "@asenajs/ioc";
import type { JudgeLabels, Scored, ScoredAction, ScoringConfig, WeightTable } from "./types/scoring.ts";

/**
 * Turns judge labels into a contract score (0-100, rounded to two decimals) and the action the poster takes, by the
 * scoring config of one run. Pure: the same labels and the same config always give the same result. The config is the
 * one `ConfigLoader` checked against the schema when it loaded the file, so a bad scoring config stops a review before
 * any model call.
 */
@Service("kerpeten:scorer")
export class Scorer {
  public static readonly MAX_SCORE = 100;

  public static readonly SCORE_SCALE = 100;

  public rate(labels: JudgeLabels, config: ScoringConfig): Scored {
    if (labels.verdict === "refuted") return { score: 0, action: "stored" };

    const { scoring, thresholds } = config;

    const points =
      Scorer.weight("priority", scoring.priority, labels.priority) +
      Scorer.weight("nature", scoring.nature, labels.nature) +
      Scorer.weight("fix_effort", scoring.fix_effort, labels.fix_effort);

    const product = points * Scorer.weight("verdict", scoring.verdict, labels.verdict);

    const score = Math.min(Scorer.MAX_SCORE, Math.round(product * Scorer.SCORE_SCALE) / Scorer.SCORE_SCALE);

    return { score, action: Scorer.action(score, thresholds) };
  }

  private static action(score: number, thresholds: ScoringConfig["thresholds"]): ScoredAction {
    if (score >= thresholds.inline) return "inline";

    if (score >= thresholds.summary) return "summary";

    return "stored";
  }

  private static weight(field: string, table: WeightTable, label: unknown): number {
    if (typeof label !== "string" || !Object.hasOwn(table, label))
      throw new RangeError(`unknown ${field} label: ${String(label)}`);

    return table[label] as number;
  }
}

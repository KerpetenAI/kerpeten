import { describe, expect, test } from "bun:test";
import { ConfigLoader } from "../../../src/capability/config/ConfigLoader.ts";
import { scoringConfigSchema } from "../../../src/capability/config/schemas/config-schema.ts";
import type { KerpetenConfig } from "../../../src/capability/config/types/config.ts";
import { Scorer } from "../../../src/layer/scoring/Scorer.ts";
import type { JudgeLabels, ScoringConfig } from "../../../src/layer/scoring/types/scoring.ts";
import { issueMessages } from "../../../src/validation/validation-utils.ts";
import { component } from "../../harnesses/harnesses-utils.ts";

const scorer = await component(Scorer, [Scorer]);

function config(extra = ""): KerpetenConfig {
  const parsed = new ConfigLoader().parse(
    `models:\n  reviewer: { provider: anthropic, model: m }\n  judge: { provider: anthropic, model: m }\n${extra}`,
  );

  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));

  return parsed.config;
}

function problems(config: ScoringConfig): string {
  const data = { scoring: config.scoring, thresholds: config.thresholds };
  const parsed = scoringConfigSchema.safeParse(data);

  return parsed.success ? "" : issueMessages(parsed.error.issues, data).join("; ");
}

function labels(
  priority: JudgeLabels["priority"],
  nature: JudgeLabels["nature"],
  fix_effort: JudgeLabels["fix_effort"],
  verdict: JudgeLabels["verdict"],
): JudgeLabels {
  return { priority, nature, fix_effort, verdict };
}

const MVP_ROWS = [
  { labels: labels("P0", "critical", "easy", "verified"), score: 95, action: "inline" },
  { labels: labels("P1", "critical", "hard", "verified"), score: 60, action: "inline" },
  { labels: labels("P1", "edge_case", "easy", "verified"), score: 50, action: "summary" },
  { labels: labels("P0", "critical", "hard", "unverified"), score: 42.5, action: "summary" },
  { labels: labels("P2", "edge_case", "hard", "verified"), score: 15, action: "stored" },
] as const;

describe("scorer with the default config", () => {
  const defaults = config();

  test("matches the five kerpeten-mvp.md rows", () => {
    for (const row of MVP_ROWS) {
      expect({ labels: row.labels, ...scorer.rate(row.labels, defaults) }).toEqual({
        labels: row.labels,
        score: row.score,
        action: row.action,
      });
    }
  });

  test("default summary threshold 20 is reached exactly and missed below", () => {
    expect(scorer.rate(labels("P1", "edge_case", "hard", "unverified"), defaults)).toEqual({
      score: 20,
      action: "summary",
    });

    expect(scorer.rate(labels("P2", "critical", "hard", "unverified"), defaults)).toEqual({
      score: 17.5,
      action: "stored",
    });
  });

  test("scores a refuted finding 0 and only stores it", () => {
    expect(scorer.rate(labels("P0", "critical", "easy", "refuted"), defaults)).toEqual({ score: 0, action: "stored" });
  });

  test("gives the same result for the same labels and config", () => {
    for (const row of MVP_ROWS) {
      const first = scorer.rate(row.labels, defaults);

      expect(scorer.rate(row.labels, defaults)).toEqual(first);

      expect(scorer.rate({ ...row.labels }, config())).toEqual(first);
    }
  });
});

describe("scorer thresholds", () => {
  test("a score equal to a threshold reaches it", () => {
    const given = config("thresholds: { inline: 50, summary: 15 }");

    expect(scorer.rate(labels("P1", "edge_case", "easy", "verified"), given)).toEqual({ score: 50, action: "inline" });

    expect(scorer.rate(labels("P2", "edge_case", "hard", "verified"), given)).toEqual({ score: 15, action: "summary" });
  });

  test("a score just below a threshold falls to the next action", () => {
    const given = config("thresholds: { inline: 50.5, summary: 15.5 }");

    expect(scorer.rate(labels("P1", "edge_case", "easy", "verified"), given)).toEqual({ score: 50, action: "summary" });

    expect(scorer.rate(labels("P2", "edge_case", "hard", "verified"), given)).toEqual({ score: 15, action: "stored" });
  });

  test("rounds the score to two decimals before the threshold check", () => {
    const unverified = config("scoring: { verdict: { unverified: 0.7 } }\nthresholds: { inline: 59.5, summary: 20 }");

    expect(scorer.rate(labels("P0", "critical", "hard", "unverified"), unverified)).toEqual({
      score: 59.5,
      action: "inline",
    });

    const verified = config(
      "scoring: { priority: { P0: 65 }, verdict: { verified: 0.57 } }\nthresholds: { inline: 57, summary: 20 }",
    );

    expect(scorer.rate(labels("P0", "critical", "easy", "verified"), verified)).toEqual({
      score: 57,
      action: "inline",
    });
  });

  test("zero thresholds post every unrefuted finding inline", () => {
    const given = config(
      "scoring: { fix_effort: { hard: 0 }, nature: { edge_case: 0 }, priority: { P2: 0 } }\nthresholds: { inline: 0, summary: 0 }",
    );

    expect(scorer.rate(labels("P2", "edge_case", "hard", "verified"), given)).toEqual({ score: 0, action: "inline" });

    expect(scorer.rate(labels("P2", "edge_case", "hard", "refuted"), given)).toEqual({ score: 0, action: "stored" });
  });

  test("an inline threshold of 100 is still reachable", () => {
    const given = config("thresholds: { inline: 100, summary: 100 }");

    expect(scorer.rate(labels("P0", "critical", "easy", "verified"), given)).toEqual({ score: 95, action: "stored" });

    const full = config("scoring: { priority: { P0: 65 } }\nthresholds: { inline: 100, summary: 100 }");

    expect(scorer.rate(labels("P0", "critical", "easy", "verified"), full)).toEqual({ score: 100, action: "inline" });
  });

  test("two-decimal weights reach an equal two-decimal threshold", () => {
    const given = config(
      "scoring: { priority: { P1: 35.07 }, fix_effort: { hard: 0.29 } }\nthresholds: { inline: 60.36, summary: 20 }",
    );

    expect(scorer.rate(labels("P1", "critical", "hard", "verified"), given)).toEqual({
      score: 60.36,
      action: "inline",
    });
  });

  test("near-grid weights and thresholds snap to hundredths so an equal score still reaches the threshold", () => {
    const parsed = config(
      "scoring: { priority: { P1: 35.00000000000001 } }\nthresholds: { inline: 60.00000000000001, summary: 20.000000000000004 }",
    );

    expect(parsed.scoring.priority.P1).toBe(35);

    expect(parsed.thresholds).toEqual({ inline: 60, summary: 20 });

    expect(scorer.rate(labels("P1", "critical", "hard", "verified"), parsed)).toEqual({ score: 60, action: "inline" });

    const direct = scoringConfigSchema.parse({
      scoring: parsed.scoring,
      thresholds: { inline: 60.00000000000001, summary: 20.000000000000004 },
    });

    expect(scorer.rate(labels("P1", "critical", "hard", "verified"), direct)).toEqual({ score: 60, action: "inline" });
  });
});

describe("scorer limits", () => {
  const heavy = config(
    "scoring:\n  priority: { P0: 100, P1: 100, P2: 100 }\n  nature: { critical: 100, edge_case: 100 }\n  fix_effort: { easy: 100, hard: 100 }",
  );

  test("caps a weight sum above 100 at the contract maximum", () => {
    expect(scorer.rate(labels("P0", "critical", "easy", "verified"), heavy)).toEqual({ score: 100, action: "inline" });

    expect(scorer.rate(labels("P2", "edge_case", "hard", "unverified"), heavy)).toEqual({
      score: 100,
      action: "inline",
    });
  });

  test("keeps a refuted finding at 0 whatever the weights", () => {
    expect(scorer.rate(labels("P0", "critical", "easy", "refuted"), heavy)).toEqual({ score: 0, action: "stored" });
  });

  test("refuses a label the config has no weight for", () => {
    const given = config();

    const bad = { ...labels("P0", "critical", "easy", "verified"), priority: "P3" } as unknown as JudgeLabels;

    expect(() => scorer.rate(bad, given)).toThrow("unknown priority label: P3");

    const inherited = { ...labels("P0", "critical", "easy", "verified"), nature: "toString" } as unknown as JudgeLabels;

    expect(() => scorer.rate(inherited, given)).toThrow("unknown nature label: toString");
  });

  test("the scoring schema refuses a config outside its ranges", () => {
    const base = config();

    expect(problems(base)).toBe("");

    const negative = { ...base, scoring: { ...base.scoring, priority: { ...base.scoring.priority, P1: -1 } } };

    expect(problems(negative)).toContain("/scoring/priority/P1:");

    const boosted = { ...base, scoring: { ...base.scoring, verdict: { ...base.scoring.verdict, verified: 1.5 } } };

    expect(problems(boosted)).toContain("/scoring/verdict/verified:");

    const nan = { ...base, thresholds: { ...base.thresholds, inline: Number.NaN } };

    expect(problems(nan)).toContain("/thresholds/inline:");

    const finePriority = { ...base, scoring: { ...base.scoring, priority: { ...base.scoring.priority, P1: 35.004 } } };

    expect(problems(finePriority)).toContain("/scoring/priority/P1:");

    const fineInline = { ...base, thresholds: { ...base.thresholds, inline: 60.004 } };

    expect(problems(fineInline)).toContain("/thresholds/inline:");

    const inverted = { ...base, thresholds: { inline: 20, summary: 60 } };

    expect(problems(inverted)).toContain("/thresholds: summary must not be above inline");
  });
});

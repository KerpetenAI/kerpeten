import { afterEach, describe, expect, test } from "bun:test";
import { ScoreStep } from "../../../../src/workflow/review/step/ScoreStep.ts";
import { candidates, cleanDirs, good, labels, repoWithBranch, reviewComponent } from "../review-utils.ts";

afterEach(cleanDirs);

describe("score flow step", () => {
  test("scores the labelled findings and stores the rest with their judge error", async () => {
    const { repo } = repoWithBranch();
    const second = { ...good, title: "Second" };
    const third = { ...good, title: "Third" };
    const state = await candidates(repo, [good, second, third]);

    const added = (await reviewComponent(ScoreStep)).execute({
      ...state,
      judged: {
        outcomes: [{ labels }, { judgeError: { reason: "model_error", message: "overloaded" } }],
        usage: { role: "judge", provider: "anthropic", model: "m", input_tokens: 1, output_tokens: 1, calls: 2 },
        toolCalls: 0,
        unknownUsageCalls: 0,
        partialReason: undefined,
      },
    });

    expect(added).toEqual({
      findings: [
        {
          ...good,
          verdict: "verified",
          priority: "P1",
          nature: "edge_case",
          fix_effort: "easy",
          rationale: "y is never checked",
          score: 50,
          action: "summary",
        },
        { ...second, judge_error: "model_error: overloaded", action: "stored" },
        { ...third, judge_error: "harness_error: the finding was not judged", action: "stored" },
      ],
    });
  });
});

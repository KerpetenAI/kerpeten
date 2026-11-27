import { describe, expect, test } from "bun:test";
import { type HarnessLogger, RunScope } from "../../../src/harness-kit/index.ts";
import { JudgeHarness } from "../../../src/harnesses/judge/JudgeHarness.ts";
import { JudgePool } from "../../../src/harnesses/judge/JudgePool.ts";
import type { JudgeOutput, JudgeStepLimits, JudgeStepOptions } from "../../../src/harnesses/judge/types/judge.ts";
import type { ReviewerFinding } from "../../../src/harnesses/review/types/review.ts";
import { noRun } from "../../harness-kit/harness-kit-utils.ts";
import { capturingLogger, component, log } from "../harnesses-utils.ts";
import type { FakeJudgeAnswer } from "../types/harnesses.ts";
import { FakeJudgeLlm } from "./FakeJudgeLlm.ts";
import { FakeJudgeSession } from "./FakeJudgeSession.ts";

const base: ReviewerFinding = {
  file: "src/a.ts",
  start_line: 2,
  end_line: 2,
  category: "bug",
  title: "A",
  body: "y can be 0",
  fix: "Throw when y is 0.",
  evidence: [{ location: "src/a.ts:2" }],
};

function labels(name: string): JudgeOutput {
  return {
    verdict: "verified",
    priority: "P1",
    nature: "edge_case",
    fix_effort: "easy",
    rationale: name,
    evidence: [{ location: "src/a.ts:2" }],
  };
}

function findings(...names: string[]): ReviewerFinding[] {
  return names.map((title) => ({ ...base, title }));
}

function fake(answers: Record<string, Partial<FakeJudgeAnswer>> = {}): FakeJudgeLlm {
  return new FakeJudgeLlm((context) => {
    const name = FakeJudgeLlm.titleOf(context);

    return { name, labels: labels(name), ...answers[name] };
  });
}

const pool = await component(JudgePool, [JudgeHarness, JudgePool]);

function step(
  llm: FakeJudgeLlm,
  limits: Partial<JudgeStepLimits> = {},
  now: () => number = () => 0,
  flowStepLog: HarnessLogger = log,
): JudgeStepOptions {
  return {
    llm,
    limits: { parallel: 4, maxToolCalls: 15, durationMinutes: 10, ...limits },
    now,
    log: flowStepLog,
  };
}

function judge(options: JudgeStepOptions, names: ReviewerFinding[]) {
  return RunScope.enter(noRun(), () =>
    pool.judge({ findings: names, patch: "", commentLanguage: "en", promptVersion: "v1" }, options),
  );
}

function rationales(outcomes: readonly ({ labels: JudgeOutput } | { judgeError: unknown })[]): string[] {
  return outcomes.map((outcome) => ("labels" in outcome ? outcome.labels.rationale : "error"));
}

describe("judge flow step", () => {
  test("never runs more calls at once than the limit", async () => {
    const llm = fake(Object.fromEntries(["A", "B", "C", "D", "E", "F"].map((name) => [name, { delayMs: 15 }])));
    const result = await judge(step(llm, { parallel: 2 }), findings("A", "B", "C", "D", "E", "F"));

    expect(llm.maxRunning).toBe(2);
    expect(rationales(result.outcomes)).toEqual(["A", "B", "C", "D", "E", "F"]);
  });

  test("with a limit of 1 the calls run one after the other", async () => {
    const llm = fake({ A: { delayMs: 20 }, B: { delayMs: 5 } });

    await judge(step(llm, { parallel: 1 }), findings("A", "B", "C"));

    expect(llm.maxRunning).toBe(1);
    expect(llm.events).toEqual(["start A", "end A", "start B", "end B", "start C", "end C"]);
  });

  test("keeps the reviewer's order whatever order the calls end in", async () => {
    const llm = fake({ B: { delayMs: 40 }, C: { delayMs: 20 } });
    const result = await judge(step(llm, { parallel: 3 }), findings("A", "B", "C", "D"));

    expect(llm.events.filter((event) => event.startsWith("end"))).toEqual(["end A", "end D", "end C", "end B"]);
    expect(rationales(result.outcomes)).toEqual(["A", "B", "C", "D"]);
  });

  test("a call that fails or throws gives only its own finding a judge error", async () => {
    const llm = fake({
      B: { throws: true },
      C: { labels: undefined, error: "overloaded" },
    });

    const result = await judge(step(llm), findings("A", "B", "C", "D"));

    expect(result.outcomes[0]).toEqual({ labels: labels("A") });
    expect(result.outcomes[1]).toEqual({ judgeError: { reason: "harness_error", message: "session of B broke" } });
    expect(result.outcomes[2]).toEqual({ judgeError: { reason: "model_error", message: "overloaded" } });
    expect(result.outcomes[3]).toEqual({ labels: labels("D") });
    expect(result.partialReason).toBeUndefined();
  });

  test("every line of a judge call carries the number of its finding, with a line at its start and its end", async () => {
    const llm = fake({ A: { delayMs: 20 }, C: { labels: undefined, error: "overloaded" } });
    const captured = capturingLogger();

    await judge(
      step(llm, { parallel: 3 }, () => 0, captured.log),
      findings("A", "B", "C"),
    );

    const calls = captured.lines.filter((line) => !line.message.startsWith("judge stage"));

    expect(calls.length).toBeGreaterThan(0);

    for (const line of calls) expect([1, 2, 3]).toContain(line.fields.finding as number);

    expect(calls.filter((line) => line.message === "judging finding").map((line) => line.fields)).toEqual([
      { finding: 1, of: 3, file: "src/a.ts" },
      { finding: 2, of: 3, file: "src/a.ts" },
      { finding: 3, of: 3, file: "src/a.ts" },
    ]);

    const ends = calls
      .filter((line) => line.level === "info" && line.message.startsWith("finding "))
      .sort((a, b) => Number(a.fields.finding) - Number(b.fields.finding));

    const judged = { file: "src/a.ts", verdict: "verified", priority: "P1", nature: "edge_case", ms: 0 };

    expect(ends.map((line) => [line.message, line.fields])).toEqual([
      ["finding judged", { finding: 1, ...judged }],
      ["finding judged", { finding: 2, ...judged }],
      ["finding not judged", { finding: 3, file: "src/a.ts", reason: "model_error", ms: 0 }],
    ]);
  });

  test("all calls share one deadline from the start of the flow step", async () => {
    const clock = { now: 1_000 };
    const llm = fake({ A: { onRun: () => (clock.now += 50_000) } });

    const result = await judge(
      step(llm, { parallel: 1, durationMinutes: 1 }, () => clock.now),
      findings("A", "B", "C"),
    );

    expect(result.outcomes[0]).toEqual({ labels: labels("A") });

    for (const outcome of result.outcomes.slice(1)) {
      expect(outcome).toMatchObject({ judgeError: { reason: "time_budget" } });
    }

    expect(result.partialReason).toBe("time_budget");
    expect(llm.events).toEqual(["start A", "end A"]);
  });

  test("a call stopped by the deadline whose final answer then fails makes the flow step partial", async () => {
    const clock = { now: 1_000 };
    const llm = fake({ A: { labels: undefined, error: "overloaded", onRun: () => (clock.now += 50_000) } });

    const result = await judge(
      step(llm, { parallel: 1, durationMinutes: 1 }, () => clock.now),
      findings("A"),
    );

    expect(result.outcomes[0]).toEqual({ judgeError: { reason: "model_error", message: "overloaded" } });
    expect(result.partialReason).toBe("time_budget");
  });

  test("the flow step counts its time from its own start, not from the start of the run", async () => {
    const late = 3 * 60 * 60 * 1000;

    const result = await judge(
      step(fake(), { durationMinutes: 1 }, () => late),
      findings("A", "B", "C"),
    );

    expect(rationales(result.outcomes)).toEqual(["A", "B", "C"]);
    expect(result.partialReason).toBeUndefined();
  });

  test("a call that throws after model calls still counts its tokens in the usage", async () => {
    const llm = fake({ A: { throwsAfterUsage: true, inputTokens: 300 } });
    const result = await judge(step(llm, { parallel: 1 }), findings("A"));

    expect(result.outcomes[0]).toEqual({
      judgeError: { reason: "harness_error", message: "session of A broke after a model call" },
    });

    expect(result.usage).toEqual({
      role: "judge",
      provider: "openai",
      model: "judge-model",
      input_tokens: 300,
      output_tokens: 10,
      calls: 1,
    });
  });

  test("a call that reports a bad input count keeps its labels and the count counts as unknown", async () => {
    const llm = fake({ A: { inputTokens: -5 }, B: { inputTokens: Number.NaN } });
    const result = await judge(step(llm, { parallel: 1 }), findings("A", "B", "C"));

    expect(rationales(result.outcomes)).toEqual(["A", "B", "C"]);
    expect(result.partialReason).toBeUndefined();
    expect(result.unknownUsageCalls).toBe(2);
    expect(result.usage.input_tokens).toBe(100 + 3 * FakeJudgeSession.FINAL_INPUT_TOKENS);
    expect(result.usage.calls).toBe(6);
  });

  test("a call that throws after tool calls still counts them, within the tool limit", async () => {
    const llm = fake({ A: { toolCalls: 3, throwsAfterUsage: true }, B: { toolCalls: 1 } });
    const result = await judge(step(llm, { parallel: 1, maxToolCalls: 2 }), findings("A", "B"));

    expect(result.outcomes[0]).toMatchObject({ judgeError: { reason: "harness_error" } });
    expect(result.outcomes[1]).toEqual({ labels: labels("B") });
    expect(result.toolCalls).toBe(3);
  });

  test("the tool limit applies to each judge call", async () => {
    const llm = fake({ A: { toolCalls: 5 }, B: { toolCalls: 5 } });
    const result = await judge(step(llm, { maxToolCalls: 2 }), findings("A", "B"));
    const skipped = llm.toolOutputs.filter((output) => String(output).startsWith("not run: the tool call budget"));

    expect(result.toolCalls).toBe(4);
    expect(skipped.length).toBe(6);
    expect(rationales(result.outcomes)).toEqual(["A", "B"]);
  });

  test("without a tool limit every tool call of a judge call runs", async () => {
    const llm = fake({ A: { toolCalls: 40 } });

    const unlimited: JudgeStepOptions = {
      llm,
      limits: { parallel: 4, durationMinutes: 10 },
      now: () => 0,
      log,
    };

    const result = await judge(unlimited, findings("A"));
    const skipped = llm.toolOutputs.filter((output) => String(output).startsWith("not run: the tool call budget"));

    expect(result.toolCalls).toBe(40);
    expect(skipped.length).toBe(0);
    expect(rationales(result.outcomes)).toEqual(["A"]);
  });

  test("sums the usage of every call under the judge model", async () => {
    const llm = fake();
    const result = await judge(step(llm), findings("A", "B", "C"));

    expect(result.usage).toEqual({
      role: "judge",
      provider: "openai",
      model: "judge-model",
      input_tokens: 3 * (100 + FakeJudgeSession.FINAL_INPUT_TOKENS),
      output_tokens: 60,
      calls: 6,
    });
  });

  test("refuses limits outside their range before any judge call", async () => {
    const bad: Partial<JudgeStepLimits>[] = [
      { parallel: 0 },
      { parallel: 17 },
      { parallel: 1.5 },
      { parallel: Number.NaN },
      { maxToolCalls: 0 },
      { durationMinutes: -1 },
    ];

    for (const limits of bad) {
      const llm = fake();

      await expect(judge(step(llm, limits), findings("A"))).rejects.toThrow(RangeError);
      expect(llm.events).toEqual([]);
    }
  });
});

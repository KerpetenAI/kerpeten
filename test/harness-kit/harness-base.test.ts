import { describe, expect, test } from "bun:test";
import { Budget } from "../../src/harness-kit/Budget.ts";
import { Run } from "../../src/harness-kit/index.ts";
import { GrepTestHarness } from "./GrepTestHarness.ts";
import {
  bodies,
  capturingLogger,
  limits,
  log,
  mockClient,
  noRun,
  promptText,
  resetRecords,
  spyToolbox,
  toolAnswers,
} from "./harness-kit-utils.ts";
import { SearchCapability } from "./SearchCapability.ts";
import { TestHarness } from "./TestHarness.ts";

const read = (path: string) => ({ name: "read_file", input: { path } });

function run(script: Parameters<typeof mockClient>[0], limitOverrides = {}, now: () => number = () => 0) {
  const mock = mockClient(script);

  const harness = new TestHarness();

  const options = {
    llm: mock.client,
    run: noRun(),
    limits: limits(limitOverrides),
    now,
    log,
  };

  const tools = { executed: spyToolbox(harness) };
  const result = harness.run("request", options);

  return { result, mock, tools };
}

describe("a harness and its run", () => {
  test("a run no workflow started is refused before the model is called; a test run is taken", async () => {
    const refused = mockClient([{ text: "done" }, { text: '{"n":1}' }]);

    const outside = new TestHarness().run("request", {
      llm: refused.client,
      run: new Run({ group: "all", every: true }),
      limits: limits(),
      now: () => 0,
      log,
    });

    await expect(outside).rejects.toThrow(
      "the harness test ran in a run no workflow started; a harness runs in a flow step of a workflow, and only a run opened with test: true runs one without",
    );

    expect(refused.calls.length).toBe(0);

    const taken = mockClient([{ text: "done" }, { text: '{"n":1}' }]);

    const inside = await new TestHarness().run("request", {
      llm: taken.client,
      run: new Run({ group: "all", every: true }, { test: true }),
      limits: limits(),
      now: () => 0,
      log,
    });

    expect(inside).toMatchObject({ value: { n: 1 }, partialReason: undefined });
  });
});

describe("agent loop", () => {
  test("runs tool calls until the model stops, then finalizes", async () => {
    const { result, mock, tools } = run([
      { toolCalls: [read("a.ts"), { name: "shell", input: { cmd: "rm -rf /" } }] },
      { toolCalls: [read("b.ts")] },
      { text: "done" },
      { text: '{"n":7}' },
    ]);

    const r = await result;

    expect(r).toMatchObject({ value: { n: 7 }, partialReason: undefined, toolCalls: 3, steps: 3 });
    expect(r.usage.length).toBe(4);
    expect(tools.executed.map((e) => e.name)).toEqual(["read_file", "read_file"]);
    expect(promptText(mock.calls[1])).toContain("unavailable tool 'shell'");

    const answers = toolAnswers(mock.calls[3]);

    expect(answers.calls.length).toBe(3);

    for (const id of answers.calls) expect(answers.results[id]).toBe(1);
    for (const call of mock.calls) expect(call.maxOutputTokens).toBe(900);

    expect(mock.calls[3]?.toolChoice).toEqual({ type: "none" });
  });

  test("a full tool call budget in the middle of a step answers the rest with an error and gives a partial result", async () => {
    const { result, mock, tools } = run([{ toolCalls: [read("a"), read("b"), read("c")] }, { text: '{"n":1}' }], {
      maxToolCalls: 2,
    });

    const r = await result;

    expect(r).toMatchObject({ value: { n: 1 }, partialReason: "tool_call_budget", toolCalls: 2, steps: 1 });
    expect(tools.executed.length).toBe(2);

    const final = promptText(mock.calls[1]);

    expect(final).toContain("not run: the tool call budget is used up");
    expect(final.match(/"type":"tool-result"/g)?.length).toBe(3);
  });

  test("a model that never stops asking for tools ends at the tool call budget", async () => {
    const script = [...Array.from({ length: 6 }, () => ({ toolCalls: [read("a")] })), { text: '{"n":2}' }];
    const { result, mock } = run(script, { maxToolCalls: 5 });
    const r = await result;

    expect(r).toMatchObject({ value: { n: 2 }, partialReason: "tool_call_budget", toolCalls: 5, steps: 6 });
    expect(mock.calls.length).toBe(7);
  });

  test("without a tool call limit every tool call runs and the result is complete", async () => {
    const script = [
      ...Array.from({ length: 25 }, () => ({ toolCalls: [read("a")] })),
      { text: "done" },
      { text: '{"n":3}' },
    ];

    const { maxToolCalls: _limit, ...unlimited } = limits();
    const mock = mockClient(script);

    const harness = new TestHarness();

    const options = {
      llm: mock.client,
      run: noRun(),
      limits: unlimited,
      now: () => 0,
      log,
    };

    const executed = spyToolbox(harness);
    const r = await harness.run("request", options);

    expect(r).toMatchObject({ value: { n: 3 }, partialReason: undefined, toolCalls: 25, steps: 26 });
    expect(executed.length).toBe(25);
  });

  test("a model that uses exactly the tool call budget and then stops gives a complete result", async () => {
    const script = [
      ...Array.from({ length: 3 }, () => ({ toolCalls: [read("a")] })),
      { text: "done" },
      { text: '{"n":11}' },
    ];

    const { result, mock, tools } = run(script, { maxToolCalls: 3 });
    const r = await result;

    expect(r).toMatchObject({ value: { n: 11 }, partialReason: undefined, toolCalls: 3, steps: 4 });
    expect(tools.executed.length).toBe(3);
    expect(mock.calls.length).toBe(5);
  });

  test("a time budget that is already over skips the steps and still finalizes", async () => {
    const { result, mock } = run(
      [{ text: '{"n":4}' }],
      { stepDeadline: 100, finalizeDeadline: Date.now() + 60_000 },
      () => 100,
    );

    const r = await result;

    expect(r).toMatchObject({ value: { n: 4 }, partialReason: "time_budget", steps: 0 });
    expect(mock.calls.length).toBe(1);
  });

  test("a step that runs past the deadline is aborted and the review finalizes as partial", async () => {
    const { result } = run(
      [{ wait: true }, { text: '{"n":5}' }],
      { stepDeadline: Date.now() + 50, finalizeDeadline: Date.now() + 60_000 },
      Date.now,
    );

    expect(await result).toMatchObject({ value: { n: 5 }, partialReason: "time_budget", steps: 1 });
  });

  test("a model error in a step still tries to finalize", async () => {
    const { result } = run([{ error: new Error("overloaded") }, { text: '{"n":6}' }]);

    expect(await result).toMatchObject({ value: { n: 6 }, partialReason: "model_error", error: "overloaded" });
  });

  test("when the final answer also fails there is no value and the reason is model_error", async () => {
    const { result } = run([{ error: new Error("down") }, { error: new Error("still down") }]);
    const r = await result;

    expect(r).toMatchObject({ value: undefined, partialReason: "model_error" });
    expect(r.usage.length).toBe(2);
  });

  test("a call whose capability the group does not give fails at the call, is counted and the run goes on", async () => {
    const mock = mockClient([
      { toolCalls: [{ name: "grep", input: { pattern: "x" } }, read("a")] },
      { text: "done" },
      { text: '{"n":2}' },
    ]);

    resetRecords();

    const captured = capturingLogger();

    const result = await new GrepTestHarness().run("request", {
      llm: mock.client,
      run: noRun(),
      limits: limits({ maxToolCalls: 2 }),
      now: () => 0,
      log: captured.log,
    });

    expect(result).toMatchObject({ value: { n: 2 }, partialReason: undefined, toolCalls: 2 });
    expect(bodies.map((body) => body.name)).toEqual(["grep", "read_file"]);

    expect(promptText(mock.calls[1])).toContain(
      'grep failed: FakeGrepTool.searcher needs the capability search, which the permission group \\"none\\" does not give',
    );

    expect(captured.lines.filter((line) => line.level === "warn")).toEqual([]);
  });

  test("a step with only invalid tool calls answers each once and keeps going", async () => {
    const { result, mock, tools } = run([
      {
        toolCalls: [
          { name: "shell", input: {} },
          { name: "read_file", raw: "{oops" },
        ],
      },
      { text: "done" },
      { text: '{"n":8}' },
    ]);

    expect(await result).toMatchObject({ value: { n: 8 }, partialReason: undefined, toolCalls: 2, steps: 2 });
    expect(tools.executed).toEqual([]);

    const answers = toolAnswers(mock.calls[1]);

    expect(answers.calls.length).toBe(2);

    for (const id of answers.calls) expect(answers.results[id]).toBe(1);
  });

  test("a tool call cut off by the output limit is not run, gets one error result and the review finalizes complete", async () => {
    const mock = mockClient([
      { toolCalls: [read("a"), { name: "shell", input: {} }], finish: "length" },
      { text: '{"n":12}' },
    ]);

    const captured = capturingLogger();

    const harness = new TestHarness();

    const options = {
      llm: mock.client,
      run: noRun(),
      limits: limits(),
      now: () => 0,
      log: captured.log,
    };

    const executed = spyToolbox(harness);
    const r = await harness.run("request", options);

    expect(r).toMatchObject({ value: { n: 12 }, partialReason: undefined, toolCalls: 1, steps: 1 });
    expect(executed).toEqual([]);
    expect(mock.calls.length).toBe(2);

    const answers = toolAnswers(mock.calls[1]);

    expect(answers.calls.length).toBe(2);

    for (const id of answers.calls) expect(answers.results[id]).toBe(1);

    expect(promptText(mock.calls[1])).toContain("not run: the answer was cut off");

    expect(captured.lines.filter((line) => line.level === "warn").map((line) => line.message)).toEqual([
      "tool call cut off",
      "tool call refused",
    ]);

    expect(JSON.stringify(mock.calls[1]?.prompt[3])).toMatch(/"toolName":"read_file".*"toolName":"shell"/);
  });

  test("a tool call during the final answer after a budget stop is retried", async () => {
    const { result, mock } = run(
      [{ toolCalls: [read("a"), read("b")] }, { toolCalls: [read("c")] }, { text: '{"n":10}' }],
      { maxToolCalls: 1 },
    );

    const r = await result;

    expect(r).toMatchObject({ value: { n: 10 }, partialReason: "tool_call_budget", steps: 1 });
    expect(r.usage.map((u) => u.inputTokens)).toEqual([100, 100, 100]);
    expect(mock.calls.length).toBe(3);
  });

  test("output that never validates gives no value and model_error", async () => {
    const { result } = run([{ text: "done" }, { text: "{}" }, { text: "[]" }]);

    expect(await result).toMatchObject({ value: undefined, partialReason: "model_error" });
  });
});

describe("progress lines", () => {
  test("every listed tool is offered to the model, and each tool call, model step and the final answer is logged", async () => {
    resetRecords();

    const mock = mockClient([
      { toolCalls: [{ name: "grep", input: { pattern: "secret" } }, read("a.ts")] },
      { text: "done" },
      { text: '{"n":3}' },
    ]);

    const captured = capturingLogger();

    const run = new Run({ group: "all", every: true }, { test: true }).give(SearchCapability, new SearchCapability());

    const harness = new GrepTestHarness();

    const options = {
      llm: mock.client,
      run,
      limits: limits(),
      now: () => 0,
      log: captured.log,
    };

    const result = await harness.run("request", options);

    expect(result).toMatchObject({ value: { n: 3 }, partialReason: undefined, toolCalls: 2, steps: 2 });
    expect(mock.calls[0]?.tools?.map((tool) => tool.name)).toEqual(["read_file", "grep"]);

    expect(bodies).toEqual([
      { name: "grep", input: { pattern: "secret" } },
      { name: "read_file", input: { path: "a.ts" } },
    ]);

    expect(captured.lines.filter((line) => line.level === "warn")).toEqual([]);

    expect(captured.lines.filter((line) => line.level === "info")).toEqual([
      {
        level: "info",
        message: "tool call",
        fields: { harness: "test-with-grep", tool: "grep", input: "pattern=secret", ok: true, calls: 1 },
      },
      {
        level: "info",
        message: "tool call",
        fields: { harness: "test-with-grep", tool: "read_file", input: "path=a.ts", ok: true, calls: 2 },
      },
      {
        level: "info",
        message: "model step",
        fields: { harness: "test-with-grep", step: 1, ms: 0, input_tokens: 100, output_tokens: 10 },
      },
      {
        level: "info",
        message: "model step",
        fields: { harness: "test-with-grep", step: 2, ms: 0, input_tokens: 100, output_tokens: 10 },
      },
      {
        level: "info",
        message: "final answer",
        fields: { harness: "test-with-grep", ok: true, ms: 0, attempts: 1, input_tokens: 100, output_tokens: 10 },
      },
    ]);
  });

  test("a model step line holds the time since the step before it, and the final answer line its own time", async () => {
    let clock = 0;

    const mock = mockClient([{ toolCalls: [read("a.ts")] }, { text: "done" }, { text: '{"n":1}' }]);
    const captured = capturingLogger();

    const harness = new TestHarness();

    const options = {
      llm: mock.client,
      run: noRun(),
      limits: limits(),
      now: () => {
        clock += 5;

        return clock;
      },
      log: captured.log,
    };

    await harness.run("request", options);

    const timed = captured.lines.filter((line) => line.message === "model step" || line.message === "final answer");

    expect(timed.map((line) => line.message)).toEqual(["model step", "model step", "final answer"]);

    for (const line of timed) expect(line.fields?.ms).toBeGreaterThan(0);
  });

  test("a long tool input is cut in the log and a tool output is never logged", async () => {
    resetRecords();

    const long = "x".repeat(500);
    const mock = mockClient([{ toolCalls: [read(long)] }, { text: "done" }, { text: '{"n":1}' }]);
    const captured = capturingLogger();

    await new TestHarness().run("request", {
      llm: mock.client,
      run: noRun(),
      limits: limits(),
      now: () => 0,
      log: captured.log,
    });

    const line = captured.lines.find((entry) => entry.message === "tool call");

    expect(line?.fields?.input).toBe(`path=${"x".repeat(195)}...`);
    expect(Object.keys(line?.fields ?? {}).sort()).toEqual(["calls", "harness", "input", "ok", "tool"]);
  });
});

describe("budget", () => {
  test("refuses limits that are negative, not finite or out of order", () => {
    for (const bad of [
      limits({ maxToolCalls: -1 }),
      limits({ maxToolCalls: Number.NaN }),
      limits({ stepDeadline: 10, finalizeDeadline: 5 }),
    ]) {
      expect(() => new Budget(bad, () => 0)).toThrow();
    }
  });
});

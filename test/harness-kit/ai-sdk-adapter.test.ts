import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  AiSdkAdapter,
  AnthropicAdapter,
  type CacheMarker,
  type KeyProvider,
  OpenAiAdapter,
  OpenRouterAdapter,
} from "../../src/harness-kit/ai-sdk/index.ts";
import type { CallUsage, LlmToolCall, LlmToolResult, ToolPhaseHooks } from "../../src/harness-kit/index.ts";
import { scriptedModel, toolAnswers } from "./harness-kit-utils.ts";
import type { Captured } from "./types/fakes.ts";

const READ = {
  name: "read_file",
  description: "read a file",
  input: z.object({ path: z.string() }),
  uses: [],
};

const output = z.strictObject({ n: z.int() });

const signal = () => new AbortController().signal;

const ANTHROPIC_MARKER: CacheMarker = { anthropic: { cacheControl: { type: "ephemeral" } } };

function client(script: Parameters<typeof scriptedModel>[0], cache?: CacheMarker) {
  const scripted = scriptedModel(script);

  return {
    ...scripted,
    client: new AiSdkAdapter({
      model: scripted.model,
      provider: "anthropic",
      modelId: "m",
      maxOutputTokens: 1234,
      ...(cache === undefined ? {} : { cache }),
      maxRetries: 0,
    }),
  };
}

const INPUT = { instructions: "find bugs", context: "the diff", tools: [READ] };

function recorder(answer: (call: LlmToolCall) => LlmToolResult = (call) => ({ ...call, output: 1, isError: false })) {
  const usage: CallUsage[] = [];
  const ran: LlmToolCall[] = [];
  const refused: string[] = [];
  const cutOff: string[] = [];

  const hooks: ToolPhaseHooks = {
    runTool: async (call) => {
      ran.push(call);

      return answer(call);
    },
    onRefusedCall: (call) => {
      refused.push(call.id);
    },
    onCutOffCall: (call) => {
      cutOff.push(call.id);
    },
    shouldStop: () => false,
    onUsage: (call) => {
      usage.push(call);
    },
  };

  return { hooks, usage, ran, refused, cutOff };
}

describe("model client", () => {
  test("the tool phase runs tool calls and reports usage, and every call sends maxOutputTokens and no sampling", async () => {
    const { client: c, calls } = client([
      [
        { toolCalls: [{ name: "read_file", input: { path: "a.ts" } }] },
        { input: 50, output: 5, cacheRead: 40, cacheWrite: 3 },
      ],
      { text: "done" },
      { text: '{"n":3}' },
    ]);

    const conversation = c.start(INPUT);
    const record = recorder((call) => ({ ...call, output: { ok: true }, isError: false }));

    expect(await conversation.runTools(record.hooks, signal())).toEqual({ ok: true, steps: 2 });
    expect(record.ran).toMatchObject([{ name: "read_file", input: { path: "a.ts" } }]);
    expect(record.usage[0]).toEqual({ inputTokens: 50, outputTokens: 5, cacheReadTokens: 40, cacheWriteTokens: 3 });
    expect(record.usage.length).toBe(2);

    const final = await conversation.finalize("report now", output, signal());

    expect(final).toMatchObject({ ok: true, value: { n: 3 } });
    expect(calls.length).toBe(3);

    for (const call of calls) {
      expect(call.maxOutputTokens).toBe(1234);
      expect(call.temperature).toBeUndefined();
      expect(call.topP).toBeUndefined();
      expect(call.topK).toBeUndefined();
      expect(call.tools?.map((t) => t.name)).toEqual(["read_file"]);
    }

    expect(calls[0]?.toolChoice).toEqual({ type: "auto" });
    expect(calls[1]?.toolChoice).toEqual({ type: "auto" });
    expect(calls[2]?.toolChoice).toEqual({ type: "none" });
    expect(calls[2]?.responseFormat?.type).toBe("json");

    const roles = calls[2]?.prompt.map((m) => m.role);

    expect(roles).toEqual(["system", "user", "assistant", "tool", "assistant", "user"]);

    const tool = calls[2]?.prompt[3];

    expect(JSON.stringify(tool)).toContain('"toolCallId":"');
    expect(JSON.stringify(tool)).toContain('"type":"json","value":{"ok":true}');
  });

  test("an error tool result goes back as an error", async () => {
    const { client: c, calls } = client([
      { toolCalls: [{ name: "read_file", input: { path: "a.ts" } }] },
      { text: "done" },
      { text: '{"n":1}' },
    ]);

    const conversation = c.start(INPUT);

    await conversation.runTools(
      recorder((call) => ({ ...call, output: "no such file", isError: true })).hooks,
      signal(),
    );

    await conversation.finalize("report", output, signal());
    expect(JSON.stringify(calls[2]?.prompt[3])).toContain('"type":"error-text","value":"no such file"');
  });

  test("an unknown, malformed or schema-invalid tool call is reported as refused, never runs, and gets exactly one result", async () => {
    const { client: c, calls } = client([
      {
        toolCalls: [
          { name: "shell", input: { cmd: "ls" } },
          { name: "read_file", raw: "{not json" },
          { name: "read_file", input: { path: 5 } },
          { name: "read_file", input: { path: "a.ts" } },
        ],
      },
      { text: "done" },
      { text: '{"n":1}' },
    ]);

    const conversation = c.start(INPUT);
    const record = recorder();

    await conversation.runTools(record.hooks, signal());
    await conversation.finalize("report", output, signal());

    const answers = toolAnswers(calls[2]);

    expect(answers.calls.length).toBe(4);
    expect(record.refused).toEqual(answers.calls.slice(0, 3));
    expect(record.ran.map((call) => call.id)).toEqual(answers.calls.slice(3));
    expect(record.cutOff).toEqual([]);

    for (const id of answers.calls) expect(answers.results[id]).toBe(1);

    expect(Object.keys(answers.results).sort()).toEqual([...answers.calls].sort());
  });

  test("a tool call during finalize is retried and its usage is kept", async () => {
    const { client: c, calls } = client([
      [{ toolCalls: [{ name: "read_file", input: { path: "a.ts" } }] }, { input: 70, output: 7 }],
      { text: '{"n":9}' },
    ]);

    const final = await c.start(INPUT).finalize("report", output, signal());

    expect(final).toMatchObject({ ok: true, value: { n: 9 } });

    expect(final.usage).toEqual([
      { inputTokens: 70, outputTokens: 7, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      { inputTokens: 100, outputTokens: 10, cacheReadTokens: undefined, cacheWriteTokens: undefined },
    ]);

    expect(calls.length).toBe(2);
  });

  test("tool calls on all three finalize attempts end as invalid output", async () => {
    const { client: c, calls } = client([
      { toolCalls: [{ name: "read_file", input: { path: "a.ts" } }] },
      { toolCalls: [{ name: "read_file", input: { path: "b.ts" } }] },
      { toolCalls: [{ name: "read_file", input: { path: "c.ts" } }] },
    ]);

    const final = await c.start(INPUT).finalize("report", output, signal());

    expect(final).toMatchObject({ ok: false, kind: "invalid_output" });
    expect(final.usage.map((u) => u.inputTokens)).toEqual([100, 100, 100]);
    expect(calls.length).toBe(3);
  });

  test("an empty answer that ran out of output is tried again, and the next answer is accepted", async () => {
    const { client: c, calls } = client([
      [
        { toolCalls: [], finish: "length" },
        { input: 50, output: 900 },
      ],
      { text: '{"n":4}' },
    ]);

    const final = await c.start(INPUT).finalize("report", output, signal());

    expect(final).toMatchObject({ ok: true, value: { n: 4 } });

    expect(final.usage).toEqual([
      { inputTokens: 50, outputTokens: 900, cacheReadTokens: undefined, cacheWriteTokens: undefined },
      { inputTokens: 100, outputTokens: 10, cacheReadTokens: undefined, cacheWriteTokens: undefined },
    ]);

    expect(calls.length).toBe(2);
    expect(JSON.stringify(calls[1]?.prompt)).toBe(JSON.stringify(calls[0]?.prompt));
  });

  test("three empty answers end as invalid output and say why", async () => {
    const empty = { toolCalls: [], finish: "length" } as const;
    const { client: c, calls } = client([empty, empty, empty]);
    const final = await c.start(INPUT).finalize("report", output, signal());

    expect(final).toMatchObject({
      ok: false,
      kind: "invalid_output",
      error: "the model ended without an answer",
    });

    expect(final.usage.length).toBe(3);
    expect(calls.length).toBe(3);
  });

  test("anthropic cache marking marks the system, the context and the newest message, and never piles up", async () => {
    const read = { toolCalls: [{ name: "read_file", input: { path: "a" } }] };
    const { client: c, calls } = client([read, read, read, { text: "done" }, { text: '{"n":1}' }], ANTHROPIC_MARKER);
    const conversation = c.start(INPUT);

    await conversation.runTools(recorder().hooks, signal());
    await conversation.finalize("report", output, signal());

    const marked = (call: number) =>
      (calls[call]?.prompt ?? []).map((m) => JSON.stringify(m).includes('"cacheControl":{"type":"ephemeral"}'));

    expect(calls.map((_, i) => marked(i).filter(Boolean).length)).toEqual([2, 3, 3, 3, 3]);
    expect(marked(0)).toEqual([true, true]);
    expect(marked(1)).toEqual([true, true, false, true]);
    expect(marked(4)).toEqual([true, true, false, false, false, false, false, false, false, true]);
  });

  test("no cache marking sends no provider options", async () => {
    const { client: c, calls } = client([{ text: "done" }]);

    await c.start(INPUT).runTools(recorder().hooks, signal());
    expect(JSON.stringify(calls[0]?.prompt)).not.toContain("cacheControl");
  });

  test("output that fails validation is tried three times and then reported as invalid", async () => {
    const { client: c, calls } = client([{ text: '{"n":"x"}' }, { text: "not json" }, { text: "{}" }]);
    const final = await c.start(INPUT).finalize("report", output, signal());

    expect(final).toMatchObject({ ok: false, kind: "invalid_output" });
    expect(final.usage.length).toBe(3);
    expect(calls.length).toBe(3);
  });

  test("output that passes on the third try is accepted", async () => {
    const { client: c } = client([{ text: "{}" }, { text: "not json" }, { text: '{"n":3}' }]);
    const final = await c.start(INPUT).finalize("report", output, signal());

    expect(final).toMatchObject({ ok: true, value: { n: 3 } });
    expect(final.usage.length).toBe(3);
  });

  test("output that passes on the second try is accepted", async () => {
    const { client: c } = client([{ text: "{}" }, { text: '{"n":2}' }]);
    const final = await c.start(INPUT).finalize("report", output, signal());

    expect(final).toMatchObject({ ok: true, value: { n: 2 } });
    expect(final.usage.length).toBe(2);
  });

  test("a model error is reported, not thrown, and counts the call", async () => {
    const { client: c } = client([{ error: new Error("boom") }, { error: new Error("down") }]);
    const conversation = c.start(INPUT);
    const record = recorder();

    expect(await conversation.runTools(record.hooks, signal())).toMatchObject({
      ok: false,
      kind: "model_error",
      steps: 1,
    });

    expect(record.usage.length).toBe(1);

    const final = await conversation.finalize("report", output, signal());

    expect(final).toMatchObject({ ok: false, kind: "model_error", error: "down" });
  });

  test("a long model error is cut without splitting a surrogate pair", async () => {
    const text = `${"x".repeat(499)}\u{1F600}${"y".repeat(50)}`;
    const { client: c } = client([{ error: new Error(text) }]);
    const tools = await c.start(INPUT).runTools(recorder().hooks, signal());

    if (tools.ok) throw new Error("expected a model error");

    expect(tools.error).toBe(`${"x".repeat(499)}...`);
  });

  test("an aborted call is reported as aborted", async () => {
    const { client: c } = client([{ wait: true }, { wait: true }]);
    const controller = new AbortController();
    const conversation = c.start(INPUT);
    const record = recorder();
    const pending = conversation.runTools(record.hooks, controller.signal);

    controller.abort();
    expect(await pending).toMatchObject({ ok: false, kind: "aborted", steps: 1 });

    expect(record.usage).toEqual([
      { inputTokens: undefined, outputTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
    ]);

    const final = await conversation.finalize("report", output, AbortSignal.abort());

    expect(final).toMatchObject({ ok: false, kind: "aborted" });
  });

  test("without maxOutputTokens no call names a limit", async () => {
    const scripted = scriptedModel([{ text: "done" }, { text: '{"n":1}' }]);
    const c = new AiSdkAdapter({ model: scripted.model, provider: "openai", modelId: "m", maxRetries: 0 });
    const conversation = c.start(INPUT);

    await conversation.runTools(recorder().hooks, signal());
    await conversation.finalize("report", output, signal());

    expect(scripted.calls.length).toBe(2);

    for (const call of scripted.calls) expect(call.maxOutputTokens).toBeUndefined();
  });

  test("maxOutputTokens must be a positive whole number", () => {
    const { model } = scriptedModel([]);

    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => new AiSdkAdapter({ model, provider: "openai", modelId: "m", maxOutputTokens: bad })).toThrow(
        "maxOutputTokens",
      );
    }
  });
});

let server: ReturnType<typeof Bun.serve>;
let stray: ReturnType<typeof Bun.serve>;
const ANSWERING_MODEL = "answering-model";
const captured: Captured[] = [];
const strayHits: string[] = [];
const saved = { ...process.env };

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const body = (await request.json()) as Record<string, unknown>;

      captured.push({ path: new URL(request.url).pathname, headers: request.headers, body });

      if (body.model === ANSWERING_MODEL) {
        return Response.json({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: ANSWERING_MODEL,
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      }

      return Response.json(
        { error: { message: "refused by the test server", type: "invalid_request_error" } },
        { status: 400 },
      );
    },
  });

  stray = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request) {
      strayHits.push(request.url);

      return new Response("no", { status: 400 });
    },
  });
});

afterAll(() => {
  server.stop(true);
  stray.stop(true);
});

afterEach(() => {
  captured.length = 0;
  strayHits.length = 0;

  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];

  Object.assign(process.env, saved);
});

describe("provider wiring", () => {
  const base = () => `http://127.0.0.1:${server.port}/v1`;

  async function callOnce(provider: "anthropic" | "openai" | "openrouter", baseUrl: string | undefined, zdr = true) {
    const c = AiSdkAdapter.fromSettings({
      provider,
      model: "test-model",
      apiKey: "config-key",
      ...(baseUrl === undefined ? {} : { baseUrl }),
      zdr,
      maxOutputTokens: 777,
      maxRetries: 0,
    });

    return c.start(INPUT).runTools(recorder().hooks, signal());
  }

  async function callWithModel(provider: "anthropic" | "openai" | "openrouter", model: string, limit?: number) {
    const settings = {
      provider,
      model,
      apiKey: "config-key",
      zdr: true,
      ...(limit === undefined ? {} : { maxOutputTokens: limit }),
      maxRetries: 0,
    };

    const c =
      provider === "anthropic"
        ? AiSdkAdapter.fromSettings(settings, new AnthropicAdapter(base()))
        : AiSdkAdapter.fromSettings({ ...settings, baseUrl: base() });

    return c.start(INPUT).runTools(recorder().hooks, signal());
  }

  test("without a limit openai and openrouter send none, and anthropic sends the limit of a model it knows", async () => {
    for (const provider of ["openai", "openrouter"] as const) {
      await callWithModel(provider, "test-model");
      expect(captured.at(-1)?.body).not.toHaveProperty("max_tokens");
      expect(captured.at(-1)?.body).not.toHaveProperty("max_completion_tokens");
    }

    await callWithModel("anthropic", "claude-opus-5-5");
    expect(captured.at(-1)?.body.max_tokens).toBe(128_000);
    expect(captured.length).toBe(3);
  });

  test("an anthropic model behind another base URL is refused without a limit, before any request", () => {
    const settings = { provider: "anthropic", model: "k3", apiKey: "k", zdr: false } as const;
    const elsewhere = { ...settings, baseUrl: "https://models.example/v1" };
    const anthropic = AiSdkAdapter.ADAPTERS.anthropic;

    expect(() => anthropic.languageModel(elsewhere)).toThrow(
      "the model k3 is behind another base URL, so its output token limit is not known; set max_output_tokens for it",
    );

    expect(() => AiSdkAdapter.fromSettings(elsewhere)).toThrow("set max_output_tokens for it");
    expect(anthropic.languageModel({ ...elsewhere, maxOutputTokens: 8000 })).toBeDefined();
    expect(anthropic.languageModel(settings)).toBeDefined();
    expect(anthropic.languageModel({ ...settings, baseUrl: anthropic.defaultBaseUrl })).toBeDefined();
    expect(captured.length).toBe(0);
  });

  test("an anthropic model with an unknown limit ends as an error unless a limit is given", async () => {
    const outcome = await callWithModel("anthropic", ANSWERING_MODEL);

    expect(outcome).toMatchObject({
      ok: false,
      kind: "model_error",
      error: `the output token limit of the model ${ANSWERING_MODEL} is not known; set max_output_tokens for it`,
    });

    expect(captured.at(-1)?.body.max_tokens).toBe(4096);

    expect(await callWithModel("anthropic", ANSWERING_MODEL, 777)).toMatchObject({ ok: true });
    expect(captured.at(-1)?.body.max_tokens).toBe(777);
  });

  test("each provider sends to base_url with the given key and maxOutputTokens, ignoring provider env vars", async () => {
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${stray.port}/v1`;
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${stray.port}/v1`;
    process.env.ANTHROPIC_API_KEY = "env-key";
    process.env.OPENAI_API_KEY = "env-key";
    process.env.OPENROUTER_API_KEY = "env-key";

    const expected: Record<string, { path: string; auth: (h: Headers) => string | null }> = {
      anthropic: { path: "/v1/messages", auth: (h) => h.get("x-api-key") },
      openai: { path: "/v1/chat/completions", auth: (h) => h.get("authorization") },
      openrouter: { path: "/v1/chat/completions", auth: (h) => h.get("authorization") },
    };

    for (const provider of ["anthropic", "openai", "openrouter"] as const) {
      const outcome = await callOnce(provider, base());

      expect(outcome).toMatchObject({ ok: false, kind: "model_error" });

      const request = captured.at(-1);

      expect(request?.path).toBe(expected[provider]?.path);
      expect(expected[provider]?.auth(request?.headers ?? new Headers())).toContain("config-key");
      expect(request?.body.model).toBe("test-model");
      expect(request?.body.max_tokens ?? request?.body.max_completion_tokens).toBe(777);
      expect(request?.body.temperature).toBeUndefined();
      expect(request?.body.provider).toBeUndefined();
    }

    expect(captured.length).toBe(3);
    expect(strayHits).toEqual([]);
  });

  test("without base_url the default endpoint is used, never the environment", async () => {
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${stray.port}/v1`;
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${stray.port}/v1`;
    process.env.ANTHROPIC_API_KEY = "env-key";
    process.env.OPENAI_API_KEY = "env-key";

    const defaults = { anthropic: new AnthropicAdapter(base()), openai: new OpenAiAdapter(base()) };

    const expected = {
      anthropic: { path: "/v1/messages", tokens: "max_tokens" },
      openai: { path: "/v1/responses", tokens: "max_output_tokens" },
    } as const;

    for (const provider of ["anthropic", "openai"] as const) {
      const model = defaults[provider].languageModel({
        provider,
        model: "test-model",
        apiKey: "config-key",
        zdr: false,
      });

      const c = new AiSdkAdapter({
        model,
        provider,
        modelId: "test-model",
        maxOutputTokens: 321,
        maxRetries: 0,
      });

      expect(await c.start(INPUT).runTools(recorder().hooks, signal())).toMatchObject({
        ok: false,
        kind: "model_error",
      });

      const request = captured.at(-1);

      expect(request?.path).toBe(expected[provider].path);
      expect(request?.body[expected[provider].tokens]).toBe(321);
      expect(JSON.stringify(Object.fromEntries(request?.headers ?? []))).toContain("config-key");
    }

    expect(strayHits).toEqual([]);

    expect({
      anthropic: AiSdkAdapter.ADAPTERS.anthropic.defaultBaseUrl,
      openai: AiSdkAdapter.ADAPTERS.openai.defaultBaseUrl,
      openrouter: AiSdkAdapter.ADAPTERS.openrouter.defaultBaseUrl,
    }).toEqual({
      anthropic: "https://api.anthropic.com/v1",
      openai: "https://api.openai.com/v1",
      openrouter: "https://openrouter.ai/api/v1",
    });
  });

  test("openrouter asks for zero data retention only on its own endpoint", async () => {
    const model = new OpenRouterAdapter(base()).languageModel({
      provider: "openrouter",
      model: "m",
      apiKey: "k",
      zdr: true,
    });

    const c = new AiSdkAdapter({
      model,
      provider: "openrouter",
      modelId: "m",
      maxOutputTokens: 5,
      maxRetries: 0,
    });

    await c.start(INPUT).runTools(recorder().hooks, signal());
    expect(captured.at(-1)?.body.provider).toEqual({ zdr: true });
    await callOnce("openrouter", base(), true);
    expect(captured.at(-1)?.body.provider).toBeUndefined();
  });

  test("cache marking depends on the provider and on base_url", () => {
    const marker = (provider: KeyProvider, baseUrl?: string) =>
      AiSdkAdapter.ADAPTERS[provider].cacheMarker({
        provider,
        model: "m",
        apiKey: "k",
        zdr: false,
        ...(baseUrl === undefined ? {} : { baseUrl }),
      });

    const ephemeral = { cacheControl: { type: "ephemeral" } };

    expect(marker("anthropic")).toEqual({ anthropic: ephemeral });
    expect(marker("anthropic", "https://api.kimi.com/coding/v1")).toEqual({ anthropic: ephemeral });
    expect(marker("openrouter")).toEqual({ openrouter: ephemeral });
    expect(marker("openrouter", "http://x")).toBeUndefined();
    expect(marker("openai")).toBeUndefined();
  });

  test("an empty key or model is refused", () => {
    expect(() =>
      AiSdkAdapter.ADAPTERS.openai.languageModel({ provider: "openai", model: "m", apiKey: "", zdr: false }),
    ).toThrow("API key");

    expect(() =>
      AiSdkAdapter.ADAPTERS.openai.languageModel({ provider: "openai", model: "", apiKey: "k", zdr: false }),
    ).toThrow("model");
  });
});

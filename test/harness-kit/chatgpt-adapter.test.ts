import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { AiSdkAdapter, ChatGptAdapter, ChatGptError } from "../../src/harness-kit/ai-sdk/index.ts";
import type { ToolPhaseHooks } from "../../src/harness-kit/index.ts";

const TOKEN = "fake-access-token-for-tests-1";

const LIMIT = "subscription_sharing_usage_limit_exceeded";

const INPUT = {
  instructions: "system text",
  context: "user text",
  tools: [{ name: "read_file", description: "read a file", input: z.object({ path: z.string() }), uses: [] }],
};

const OUTPUT = z.strictObject({ n: z.int() });

const UNSUPPORTED = [
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "prompt",
  "prompt_cache_retention",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
  "previous_response_id",
];

const ENCRYPTED = "fake-encrypted-reasoning-1";

const seen: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];

const answers: Response[][] = [];

let server: ReturnType<typeof Bun.serve>;

let tokenCalls = 0;

const globals = globalThis as Record<string, unknown>;

const warnings = globals.AI_SDK_LOG_WARNINGS;

function sse(events: readonly Record<string, unknown>[]): Response {
  const text = events.map((event, index) => {
    const data = { sequence_number: index, ...event };

    return `event: ${String(event.type)}\ndata: ${JSON.stringify(data)}\n\n`;
  });

  return new Response(text.join(""), { headers: { "Content-Type": "text/event-stream" } });
}

function created(): Record<string, unknown> {
  return { type: "response.created", response: { id: "resp_1", created_at: 1, model: "m", service_tier: null } };
}

function completed(): Record<string, unknown> {
  return {
    type: "response.completed",
    response: {
      incomplete_details: null,
      usage: {
        input_tokens: 7,
        output_tokens: 3,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    },
  };
}

function textEvents(text: string, terminal: Record<string, unknown> | null = completed()) {
  const item = { type: "message", id: "msg_1", role: "assistant", status: "completed" };

  return [
    created(),
    { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
    { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: text },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: { ...item, content: [{ type: "output_text", text, annotations: [] }] },
    },
    ...(terminal === null ? [] : [terminal]),
  ];
}

function toolCallEvents() {
  const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "read_file", namespace: "tools" };
  const reasoning = { type: "reasoning", id: "rs_1", summary: [] };

  return [
    created(),
    { type: "response.output_item.added", output_index: 0, item: { ...reasoning, encrypted_content: null } },
    { type: "response.output_item.done", output_index: 0, item: { ...reasoning, encrypted_content: ENCRYPTED } },
    { type: "response.output_item.added", output_index: 1, item: { ...call, arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 1, delta: '{"path":"a.ts"}' },
    {
      type: "response.output_item.done",
      output_index: 1,
      item: { ...call, arguments: '{"path":"a.ts"}', status: "completed" },
    },
    completed(),
  ];
}

function failed(code: string): Record<string, unknown> {
  return {
    type: "response.failed",
    response: { error: { code, message: "plan limit reached" }, incomplete_details: null },
  };
}

function script(...responses: Response[]): void {
  answers.push(responses);
}

function hooks(calls: { n: number } = { n: 0 }): ToolPhaseHooks {
  return {
    runTool: async (call) => {
      calls.n++;

      return { id: call.id, name: call.name, output: "file text", isError: false };
    },
    shouldStop: () => false,
    onUsage: () => {},
    onRefusedCall: () => {},
    onCutOffCall: () => {},
  };
}

function adapter(token: () => Promise<string> = async () => TOKEN): ChatGptAdapter {
  return new ChatGptAdapter({
    token: async () => {
      tokenCalls++;

      return token();
    },
    baseUrl: `http://127.0.0.1:${server.port}/v1`,
  });
}

function client(chatgpt: ChatGptAdapter, maxRetries = 0) {
  return AiSdkAdapter.fromSettings(
    { provider: "chatgpt", model: "gpt-6.1-sol", apiKey: "", zdr: false, maxOutputTokens: 500, maxRetries },
    chatgpt,
  );
}

const signal = () => new AbortController().signal;

beforeAll(() => {
  globals.AI_SDK_LOG_WARNINGS = false;

  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const headers = Object.fromEntries(request.headers.entries());

      if (url.pathname === "/v1/models") {
        seen.push({ headers, body: {} });

        return Response.json({
          models: [
            { slug: "plan-model", display_name: "Plan Model", visibility: "list" },
            { slug: "hidden-model", display_name: "Hidden", visibility: "hide" },
          ],
        });
      }

      seen.push({ headers, body: (await request.json()) as Record<string, unknown> });

      const next = answers.shift()?.shift();

      return next ?? Response.json({ error: { message: "no scripted answer" } }, { status: 500 });
    },
  });
});

afterAll(() => {
  server.stop(true);
  globals.AI_SDK_LOG_WARNINGS = warnings;
});

beforeEach(() => {
  seen.length = 0;
  answers.length = 0;
  tokenCalls = 0;
});

describe("ChatGptAdapter", () => {
  test("every request of the tool phase and of the tools-off final answer is streamed with store false", async () => {
    script(sse(toolCallEvents()));
    script(sse(textEvents("looked")));
    script(sse(textEvents('{"n":3}')));

    const session = client(adapter()).start(INPUT);
    const tools = await session.runTools(hooks(), signal());
    const final = await session.finalize("answer now", OUTPUT, signal());

    expect(tools).toEqual({ ok: true, steps: 2 });
    expect(final).toMatchObject({ ok: true, value: { n: 3 } });
    expect(seen).toHaveLength(3);

    for (const { body, headers } of seen) {
      expect(body.store).toBe(false);
      expect(body.stream).toBe(true);
      expect(UNSUPPORTED.filter((field) => field in body)).toEqual([]);
      expect(body.model).toBe("gpt-6.1-sol");

      expect(body.tools).toEqual([
        {
          type: "namespace",
          name: "tools",
          description: "The tools of this session.",
          tools: [expect.objectContaining({ type: "function", name: "read_file" })],
        },
      ]);

      const roles = (body.input as { role?: string }[]).map((item) => item.role);

      expect(roles).not.toContain("system");
      expect(roles[0]).toBe("developer");
      expect(headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(Object.keys(headers)).not.toContain("originator");
      expect(Object.keys(headers)).not.toContain("session-id");
      expect(Object.keys(headers)).not.toContain("thread-id");
      expect(Object.keys(headers)).not.toContain("chatgpt-account-id");
    }

    expect(seen[0]?.body.tool_choice).toBe("auto");
    expect(seen[2]?.body.tool_choice).toBe("none");
    expect(seen[2]?.body.text).toMatchObject({ format: { type: "json_schema", strict: false } });

    const replayed = JSON.stringify(seen[1]?.body.input);

    expect(replayed).toContain('"namespace":"tools"');
    expect(replayed).toContain(ENCRYPTED);
    expect(seen[0]?.body.include).toEqual(["reasoning.encrypted_content"]);
    expect(replayed).toContain("call_1");
    expect(tokenCalls).toBe(3);
  });

  test("a plan limit in the middle of the stream stops the adapter and no later request goes out", async () => {
    const plan = adapter();

    script(sse([...textEvents("partial", null), failed(LIMIT)]));

    const session = client(plan).start(INPUT);
    const tools = await session.runTools(hooks(), signal());

    expect(tools).toMatchObject({ ok: false, kind: "model_error" });
    expect(tools.ok ? "" : tools.error).toContain(LIMIT);
    expect(plan.failure).toBeInstanceOf(ChatGptError);
    expect(plan.failure).toMatchObject({ kind: "usage_limit", code: LIMIT });

    const final = await session.finalize("answer now", OUTPUT, signal());

    expect(final).toMatchObject({ ok: false, kind: "model_error" });
    expect(final.ok ? "" : final.error).toContain(LIMIT);
    expect(seen).toHaveLength(1);
  });

  test("a plan limit in the tools-off final answer stops the adapter", async () => {
    const plan = adapter();

    script(sse(textEvents("done")));
    script(sse([created(), failed("subscription_sharing_usage_unavailable")]));

    const session = client(plan).start(INPUT);

    await session.runTools(hooks(), signal());

    const final = await session.finalize("answer now", OUTPUT, signal());

    expect(final).toMatchObject({ ok: false, kind: "model_error" });
    expect(plan.failure).toMatchObject({ kind: "usage_unavailable" });
    expect(seen[1]?.body.stream).toBe(true);
    expect(seen[1]?.body.store).toBe(false);
  });

  test("a plan limit answered before the stream opens is not retried", async () => {
    const plan = adapter();
    const limit = Response.json({ error: { code: LIMIT, message: "limit", type: "usage" } }, { status: 429 });

    script(limit);

    const tools = await client(plan, 2).start(INPUT).runTools(hooks(), signal());

    expect(tools).toMatchObject({ ok: false, kind: "model_error" });
    expect(plan.failure).toMatchObject({ kind: "usage_limit", status: 429 });
    expect(seen).toHaveLength(1);
  });

  test("a 401 before the stream opens stops the adapter as unauthorized", async () => {
    const plan = adapter();

    script(Response.json({ detail: "not accepted" }, { status: 401 }));

    await client(plan).start(INPUT).runTools(hooks(), signal());

    expect(plan.failure).toMatchObject({ kind: "unauthorized", status: 401 });
  });

  test("a stream that ends without response.completed fails the call but does not stop the adapter", async () => {
    const plan = adapter();

    script(sse(textEvents("cut", null)));

    const tools = await client(plan).start(INPUT).runTools(hooks(), signal());

    expect(tools).toMatchObject({ ok: false, kind: "model_error" });
    expect(tools.ok ? "" : tools.error).toContain("response.completed");
    expect(plan.failure).toBeUndefined();
  });

  test("an incomplete response fails the call but does not stop the adapter", async () => {
    const plan = adapter();
    const incomplete = { type: "response.incomplete", response: { incomplete_details: { reason: "content_filter" } } };

    script(sse(textEvents("half", incomplete)));

    const tools = await client(plan).start(INPUT).runTools(hooks(), signal());

    expect(tools).toMatchObject({ ok: false, kind: "model_error" });
    expect(tools.ok ? "" : tools.error).toContain("incomplete (content_filter)");
    expect(plan.failure).toBeUndefined();
  });

  test("a token source that throws stops the adapter before any request", async () => {
    const plan = adapter(async () => {
      throw new Error("not signed in; sign in first");
    });

    const session = client(plan).start(INPUT);
    const tools = await session.runTools(hooks(), signal());
    const final = await session.finalize("answer now", OUTPUT, signal());

    expect(tools).toMatchObject({ ok: false, kind: "model_error", error: "not signed in; sign in first" });
    expect(final).toMatchObject({ ok: false, error: "not signed in; sign in first" });
    expect(plan.failure?.message).toBe("not signed in; sign in first");
    expect(seen).toHaveLength(0);
  });

  test("lists only the models meant for display, with the bearer token", async () => {
    expect(await adapter().listModels()).toEqual([{ slug: "plan-model", displayName: "Plan Model" }]);
    expect(seen[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  test("a model list that gets no headers or no full body fails after the list timeout", async () => {
    const stalled = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(request) {
        if (new URL(request.url).pathname.startsWith("/headers/")) return new Promise<Response>(() => {});

        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"models":['));
          },
        });

        return new Response(body, { headers: { "Content-Type": "application/json" } });
      },
    });

    try {
      for (const path of ["headers", "body"]) {
        const lister = new ChatGptAdapter({
          token: async () => TOKEN,
          baseUrl: `http://127.0.0.1:${stalled.port}/${path}/v1`,
          modelListTimeoutMs: 200,
        });

        const error = await lister.listModels().catch((caught: unknown) => caught);

        expect(String(error)).toContain("the model list request got no answer within 0.2 s");
      }
    } finally {
      stalled.stop(true);
    }
  });

  test("an error event in a stream that stays open fails the call and closes the stream", async () => {
    const plan = adapter();
    const closed = Promise.withResolvers<boolean>();
    const events = [...textEvents("partial", null), failed(LIMIT)];

    const text = events
      .map(
        (event, index) =>
          `event: ${String(event.type)}\ndata: ${JSON.stringify({ sequence_number: index, ...event })}\n\n`,
      )
      .join("");

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
      },
      cancel() {
        closed.resolve(true);
      },
    });

    script(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));

    const tools = await client(plan).start(INPUT).runTools(hooks(), signal());

    expect(tools).toMatchObject({ ok: false, kind: "model_error" });
    expect(plan.failure).toMatchObject({ kind: "usage_limit", code: LIMIT });
    expect(await Promise.race([closed.promise, Bun.sleep(1000).then(() => false)])).toBe(true);
  });

  test("the chatgpt provider has no default adapter and takes no key", () => {
    expect(() =>
      AiSdkAdapter.fromSettings({ provider: "chatgpt", model: "m", apiKey: "", zdr: false, maxOutputTokens: 1 }),
    ).toThrow("ChatGptAdapter");

    expect(adapter().keyEnv).toBeUndefined();
  });

  test("ChatGptError names the code and status and classifies plan refusals", () => {
    expect(
      ChatGptError.from({ statusCode: 403, responseBody: '{"error":{"code":"chatpass_v2_scope_not_authorized"}}' }),
    ).toMatchObject({ kind: "refused", code: "chatpass_v2_scope_not_authorized", status: 403 });

    expect(ChatGptError.from({ statusCode: 500, responseBody: "{}" })).toBeUndefined();
    expect(ChatGptError.from(new Error("network down"))).toBeUndefined();
  });
});

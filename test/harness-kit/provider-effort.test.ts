import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  AiSdkAdapter,
  AnthropicAdapter,
  type Effort,
  OpenAiAdapter,
  OpenRouterAdapter,
  type Provider,
} from "../../src/harness-kit/ai-sdk/index.ts";
import type { ToolPhaseHooks } from "../../src/harness-kit/index.ts";

const EFFORTS: readonly Effort[] = ["low", "medium", "high"];

const INPUT = {
  instructions: "system text",
  context: "user text",
  tools: [{ name: "read_file", description: "read a file", input: z.object({ path: z.string() }), uses: [] }],
};

const HOOKS: ToolPhaseHooks = {
  runTool: async (call) => ({ id: call.id, name: call.name, output: null, isError: false }),
  shouldStop: () => true,
  onUsage: () => {},
  onRefusedCall: () => {},
  onCutOffCall: () => {},
};

const CASES: {
  provider: Provider;
  endpoint: "base_url" | "default";
  model: string;
  path: string;
  field: (effort: Effort) => Record<string, unknown>;
}[] = [
  {
    provider: "anthropic",
    endpoint: "base_url",
    model: "test-model",
    path: "/v1/messages",
    field: (effort) => ({ output_config: { effort } }),
  },
  {
    provider: "anthropic",
    endpoint: "default",
    model: "test-model",
    path: "/v1/messages",
    field: (effort) => ({ output_config: { effort } }),
  },
  {
    provider: "openai",
    endpoint: "base_url",
    model: "test-model",
    path: "/v1/chat/completions",
    field: (effort) => ({ reasoning_effort: effort }),
  },
  {
    provider: "openai",
    endpoint: "default",
    model: "gpt-5.1",
    path: "/v1/responses",
    field: (effort) => ({ reasoning: { effort } }),
  },
  {
    provider: "openrouter",
    endpoint: "base_url",
    model: "test-model",
    path: "/v1/chat/completions",
    field: (effort) => ({ reasoning: { effort } }),
  },
  {
    provider: "openrouter",
    endpoint: "default",
    model: "test-model",
    path: "/v1/chat/completions",
    field: (effort) => ({ reasoning: { effort } }),
  },
];

const SHAPES: Record<string, { fields: string[]; finalFields: string[]; step: unknown; final: unknown }> = {
  "/v1/messages": {
    fields: ["max_tokens", "messages", "model", "system", "tool_choice", "tools"],
    finalFields: [],
    step: { system: [{ cache_control: { type: "ephemeral" } }], tool_choice: { type: "auto" } },
    final: { tools: [{ name: "json" }], tool_choice: { type: "any", disable_parallel_tool_use: true } },
  },
  "/v1/chat/completions": {
    fields: ["max_tokens", "messages", "model", "tool_choice", "tools"],
    finalFields: ["response_format"],
    step: { tool_choice: "auto" },
    final: {
      response_format: { type: "json_schema", json_schema: { strict: true, name: "response" } },
      tool_choice: "none",
    },
  },
  "/v1/responses": {
    fields: ["input", "max_output_tokens", "model", "tool_choice", "tools"],
    finalFields: ["text"],
    step: { tool_choice: "auto" },
    final: { text: { format: { type: "json_schema", strict: true, name: "response" } }, tool_choice: "none" },
  },
};

const requests: { path: string; body: Record<string, unknown> }[] = [];

const globals = globalThis as Record<string, unknown>;

const warnings = globals.AI_SDK_LOG_WARNINGS;

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  globals.AI_SDK_LOG_WARNINGS = false;

  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      requests.push({ path: new URL(request.url).pathname, body: (await request.json()) as Record<string, unknown> });

      return Response.json(
        { error: { message: "refused by the test server", type: "invalid_request_error" } },
        { status: 400 },
      );
    },
  });
});

afterAll(() => {
  server.stop(true);
  globals.AI_SDK_LOG_WARNINGS = warnings;
});

function url(): string {
  return `http://127.0.0.1:${server.port}/v1`;
}

function providerAdapter(provider: Provider) {
  if (provider === "anthropic") return new AnthropicAdapter(url());
  if (provider === "openai") return new OpenAiAdapter(url());

  return new OpenRouterAdapter(url());
}

async function bodies(
  provider: Provider,
  endpoint: "base_url" | "default",
  model: string,
  effort: Effort | undefined,
): Promise<{ path: string; body: Record<string, unknown> }[]> {
  requests.length = 0;

  const settings = {
    provider,
    model,
    apiKey: "test-key",
    zdr: true,
    maxOutputTokens: 100,
    maxRetries: 0,
    ...(endpoint === "base_url" ? { baseUrl: url() } : {}),
    ...(effort === undefined ? {} : { effort }),
  };

  const client =
    endpoint === "base_url"
      ? AiSdkAdapter.fromSettings(settings)
      : AiSdkAdapter.fromSettings(settings, providerAdapter(provider));

  const session = client.start(INPUT);

  await session.runTools(HOOKS, new AbortController().signal);
  await session.finalize("report", z.strictObject({ n: z.int() }), new AbortController().signal);

  return [...requests];
}

function merged(base: unknown, patch: unknown): unknown {
  if (typeof base !== "object" || base === null || typeof patch !== "object" || patch === null) return patch;

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };

  for (const [key, value] of Object.entries(patch)) result[key] = merged(result[key], value);

  return result;
}

describe("effort", () => {
  test("each provider adapter names the effort in its own provider options", () => {
    expect(AiSdkAdapter.ADAPTERS.anthropic.effortOptions("low")).toEqual({ anthropic: { effort: "low" } });

    expect(AiSdkAdapter.ADAPTERS.openai.effortOptions("medium")).toEqual({
      openai: { reasoningEffort: "medium", reasoningSummary: null },
    });

    expect(AiSdkAdapter.ADAPTERS.openrouter.effortOptions("high")).toEqual({
      openrouter: { reasoning: { effort: "high" } },
    });
  });

  test("OpenRouter refuses the max effort, which it does not have", () => {
    expect(() => AiSdkAdapter.ADAPTERS.openrouter.effortOptions("max")).toThrow("OpenRouter has no `max` effort");
  });

  test("without effort each request holds only its own fields and the final answer asks for structured output", async () => {
    for (const { provider, endpoint, model, path } of CASES) {
      const shape = SHAPES[path];
      const zdr = provider === "openrouter" && endpoint === "default" ? ["provider"] : [];
      const [step, final] = await bodies(provider, endpoint, model, undefined);

      expect(Object.keys(step?.body ?? {}).sort()).toEqual([...(shape?.fields ?? []), ...zdr].sort());

      expect(Object.keys(final?.body ?? {}).sort()).toEqual(
        [...(shape?.fields ?? []), ...(shape?.finalFields ?? []), ...zdr].sort(),
      );

      expect(step?.body).toMatchObject(shape?.step as never);
      expect(final?.body).toMatchObject(shape?.final as never);

      if (zdr.length > 0) expect([step?.body.provider, final?.body.provider]).toEqual([{ zdr: true }, { zdr: true }]);
    }
  });

  for (const { provider, endpoint, model, path, field } of CASES) {
    test(`${provider} ${endpoint}: the tool step and the final answer carry the effort and nothing else changes`, async () => {
      const without = await bodies(provider, endpoint, model, undefined);

      expect(without.map((request) => request.path)).toEqual([path, path]);

      for (const effort of EFFORTS) {
        const withEffort = await bodies(provider, endpoint, model, effort);

        expect(withEffort).toEqual(
          without.map((request) => ({ path: request.path, body: merged(request.body, field(effort)) })) as never,
        );
      }
    });
  }

  test("openai default endpoint: the SDK drops the effort for a model it does not know as a reasoning model", async () => {
    const without = await bodies("openai", "default", "test-model", undefined);

    expect(await bodies("openai", "default", "test-model", "high")).toEqual(without);
  });
});

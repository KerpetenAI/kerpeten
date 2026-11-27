import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigLoader } from "../../../src/capability/config/ConfigLoader.ts";
import type { KerpetenConfig } from "../../../src/capability/config/types/config.ts";

const MODELS = `models:
  reviewer: { provider: anthropic, model: k3.1-pro, base_url: "https://api.kimi.com/coding/v1", api_key_env: KIMI_API_KEY }
  judge: { provider: openrouter, model: some/model }
`;

function ok(text: string): KerpetenConfig & { hash: string } {
  const result = new ConfigLoader().parse(text);

  if (!result.ok) throw new Error(result.errors.join("\n"));

  return { ...result.config, hash: result.hash };
}

function errors(text: string): string {
  const result = new ConfigLoader().parse(text);

  if (result.ok) throw new Error("expected the configuration to be refused");

  return result.errors.join("\n");
}

describe("config", () => {
  test("fills every default except the models", () => {
    const config = ok(MODELS);

    expect(config.models.reviewer).toEqual({
      provider: "anthropic",
      model: "k3.1-pro",
      base_url: "https://api.kimi.com/coding/v1",
      api_key_env: "KIMI_API_KEY",
    });

    expect(config.models.judge).toEqual({ provider: "openrouter", model: "some/model" });
    expect(config.backend).toBeUndefined();

    expect(config.scoring).toEqual({
      priority: { P0: 60, P1: 35, P2: 10 },
      nature: { critical: 25, edge_case: 5 },
      fix_effort: { easy: 10, hard: 0 },
      verdict: { verified: 1, unverified: 0.5 },
    });

    expect(config.thresholds).toEqual({ inline: 60, summary: 20 });

    expect(config.limits).toEqual({
      max_inline_comments: 10,
      max_duration_minutes: 60,
      max_judge_parallel: 4,
      max_judge_duration_minutes: 60,
    });

    expect(config.ignore).toEqual(["**/*.lock", "**/generated/**"]);
    expect(config.comment_language).toBe("tr");
    expect(config.openrouter).toEqual({ zdr: true });
  });

  test("keeps partially given sections and fills the rest", () => {
    const config = ok(`${MODELS}scoring:\n  priority: { P0: 70 }\nlimits: { max_tool_calls: 5 }\nignore: []\n`);

    expect(config.scoring.priority).toEqual({ P0: 70, P1: 35, P2: 10 });
    expect(config.limits.max_tool_calls).toBe(5);
    expect(config.limits.max_judge_tool_calls).toBeUndefined();
    expect(config.ignore).toEqual([]);
  });

  test("takes the judge limits apart from the reviewer limits", () => {
    const config = ok(`${MODELS}limits: { max_judge_parallel: 1, max_judge_duration_minutes: 3 }\n`);

    expect(config.limits).toMatchObject({
      max_judge_parallel: 1,
      max_judge_duration_minutes: 3,
      max_duration_minutes: 60,
    });

    expect(ok(`${MODELS}limits: { max_judge_parallel: 16 }\n`).limits.max_judge_parallel).toBe(16);
  });

  test("has no default model: a missing models section or role is refused", () => {
    expect(errors("comment_language: en\n")).toContain('missing required key "models"');
    expect(errors("models:\n  reviewer: { provider: openai, model: m }\n")).toContain('missing required key "judge"');

    expect(errors("models:\n  reviewer: { provider: openai }\n  judge: { provider: openai, model: m }\n")).toContain(
      'missing required key "model"',
    );

    expect(errors("models:\n  reviewer: { model: m }\n  judge: { provider: openai, model: m }\n")).toContain(
      '/models/reviewer: missing required key "provider"',
    );

    expect(errors("")).toContain("must be a mapping");
  });

  const refused: [string, string, string][] = [
    ["an unknown top-level key", `${MODELS}modles: {}\n`, 'unknown key "modles"'],
    ["a permissions key", `${MODELS}permissions: { "repo:read": true }\n`, 'unknown key "permissions"'],
    [
      "an unknown model key",
      MODELS.replace("model: some/model", "model: some/model, temperature: 0"),
      'unknown key "temperature"',
    ],
    ["a model name YAML reads as a number", MODELS.replace("model: some/model", "model: 3.1"), "/models/judge/model"],
    ["an unknown provider", MODELS.replace("provider: openrouter", "provider: gemini"), "/models/judge/provider"],
    ["a model name with spaces", MODELS.replace("model: some/model", 'model: "a b"'), "/models/judge/model"],
    ["an ftp base_url", MODELS.replace("https://api.kimi.com", "ftp://api.kimi.com"), "/models/reviewer/base_url"],
    [
      "a plain http base_url",
      MODELS.replace("https://api.kimi.com", "http://api.kimi.com"),
      "/models/reviewer/base_url",
    ],
    [
      "a plain http judge base_url",
      MODELS.replace("provider: openrouter", 'provider: openrouter, base_url: "http://127.0.0.1:8080/v1"'),
      "/models/judge/base_url",
    ],
    [
      "a base_url with credentials",
      MODELS.replace("https://api.kimi.com", "https://u:p@api.kimi.com"),
      "/models/reviewer/base_url",
    ],
    ["a lower-case api_key_env", MODELS.replace("KIMI_API_KEY", "kimi_key"), "/models/reviewer/api_key_env"],
    [
      "the backend token as api_key_env",
      MODELS.replace("KIMI_API_KEY", "KERPETEN_BACKEND_TOKEN"),
      "/models/reviewer/api_key_env",
    ],
    ["a CI token as api_key_env", MODELS.replace("KIMI_API_KEY", "CI_JOB_TOKEN"), "/models/reviewer/api_key_env"],
    ["the GitHub token as api_key_env", MODELS.replace("KIMI_API_KEY", "GITHUB_TOKEN"), "/models/reviewer/api_key_env"],
    ...[
      "ACTIONS_RUNTIME_TOKEN",
      "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "NPM_TOKEN",
      "_API_KEY",
    ].map((name): [string, string, string] => [
      `${name} as api_key_env`,
      MODELS.replace("KIMI_API_KEY", name),
      "/models/reviewer/api_key_env",
    ]),
    ...["CI_API_KEY", "GITHUB_API_KEY", "KERPETEN_API_KEY"].map((name): [string, string, string] => [
      `${name}, a platform or backend name, as api_key_env`,
      MODELS.replace("KIMI_API_KEY", name),
      "/models/reviewer/api_key_env",
    ]),
    [
      "zero output tokens",
      MODELS.replace("model: some/model", "model: some/model, max_output_tokens: 0"),
      "/models/judge/max_output_tokens",
    ],
    [
      "fractional output tokens",
      MODELS.replace("model: some/model", "model: some/model, max_output_tokens: 1.5"),
      "/models/judge/max_output_tokens",
    ],
    [
      "output tokens written with an underscore",
      MODELS.replace("model: some/model", "model: some/model, max_output_tokens: 16_000"),
      "/models/judge/max_output_tokens",
    ],
    ["a quoted number", `${MODELS}thresholds: { inline: "60" }\n`, "/thresholds/inline"],
    ["a score above 100", `${MODELS}scoring: { priority: { P0: 101 } }\n`, "/scoring/priority/P0"],
    ["an infinite threshold", `${MODELS}thresholds: { inline: .inf }\n`, "/thresholds/inline"],
    ["a threshold with three decimals", `${MODELS}thresholds: { inline: 60.004 }\n`, "/thresholds/inline"],
    ["a weight with three decimals", `${MODELS}scoring: { priority: { P1: 35.004 } }\n`, "/scoring/priority/P1"],
    ["a multiplier above 1", `${MODELS}scoring: { verdict: { verified: 2 } }\n`, "/scoring/verdict/verified"],
    ["summary above inline", `${MODELS}thresholds: { inline: 30, summary: 40 }\n`, "summary must not be above inline"],
    ["negative inline comments", `${MODELS}limits: { max_inline_comments: -1 }\n`, "/limits/max_inline_comments"],
    ["a zero duration", `${MODELS}limits: { max_duration_minutes: 0 }\n`, "/limits/max_duration_minutes"],
    ["zero judge calls at once", `${MODELS}limits: { max_judge_parallel: 0 }\n`, "/limits/max_judge_parallel"],
    ["17 judge calls at once", `${MODELS}limits: { max_judge_parallel: 17 }\n`, "/limits/max_judge_parallel"],
    ["a fractional judge parallelism", `${MODELS}limits: { max_judge_parallel: 2.5 }\n`, "/limits/max_judge_parallel"],
    ["a quoted judge parallelism", `${MODELS}limits: { max_judge_parallel: "4" }\n`, "/limits/max_judge_parallel"],
    [
      "a zero judge duration",
      `${MODELS}limits: { max_judge_duration_minutes: 0 }\n`,
      "/limits/max_judge_duration_minutes",
    ],
    [
      "a judge duration over six hours",
      `${MODELS}limits: { max_judge_duration_minutes: 361 }\n`,
      "/limits/max_judge_duration_minutes",
    ],
    ["an absolute ignore glob", `${MODELS}ignore: ["/etc/**"]\n`, "/ignore/0"],
    ["an ignore glob that is not a string", `${MODELS}ignore: [1]\n`, "/ignore/0"],
    ["a negated ignore glob", `${MODELS}ignore: ["**/*.lock", "!vendor/**"]\n`, "/ignore/1"],
    ["a backend URL without a scheme", `${MODELS}backend: { url: kerpeten.internal }\n`, "/backend/url"],
    ["zdr as a string", `${MODELS}openrouter: { zdr: "yes" }\n`, "/openrouter/zdr"],
    ["a list at the root", "- a\n- b\n", "must be a mapping"],
    ["a scalar at the root", "hello\n", "must be a mapping"],
    ["broken YAML", "models: [\n", "not valid YAML"],
  ];

  for (const [name, text, expected] of refused) {
    test(`refuses ${name}`, () => {
      expect(errors(text)).toContain(expected);
    });
  }

  test("accepts an api_key_env that names a provider API key", () => {
    for (const name of [
      "OPENROUTER_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "KIMI_API_KEY",
      "MY_2ND_API_KEY",
    ]) {
      expect(ok(MODELS.replace("KIMI_API_KEY", name)).models.reviewer).toMatchObject({ api_key_env: name });
    }
  });

  test("accepts a chatgpt model with a model id and an effort and nothing else", () => {
    const config = ok(
      "models:\n  reviewer: { provider: chatgpt, model: gpt-6.1-sol, effort: high }\n  judge: { provider: chatgpt, model: m }\n",
    );

    expect(config.models.reviewer).toEqual({ provider: "chatgpt", model: "gpt-6.1-sol", effort: "high" });
    expect(config.models.judge).toEqual({ provider: "chatgpt", model: "m" });
  });

  const CHATGPT = "models:\n  reviewer: { provider: chatgpt, model: m }\n  judge: { provider: openai, model: m }\n";

  for (const effort of ["xhigh", "max"] as const) {
    test(`accepts the ${effort} effort on a chatgpt model and refuses it on a key model`, () => {
      expect(ok(CHATGPT.replace("model: m }", `model: m, effort: ${effort} }`)).models.reviewer).toMatchObject({
        effort,
      });

      expect(errors(CHATGPT.replace("openai, model: m }", `openai, model: m, effort: ${effort} }`))).toContain(
        "/models/judge/effort: Invalid option",
      );
    });
  }

  for (const [key, value] of [
    ["api_key_env", "OPENAI_API_KEY"],
    ["base_url", '"https://example.invalid/v1"'],
    ["max_output_tokens", "1000"],
  ] as const) {
    test(`refuses ${key} on a chatgpt model`, () => {
      expect(errors(CHATGPT.replace("model: m }", `model: m, ${key}: ${value} }`))).toContain(`unknown key "${key}"`);
    });
  }

  test("refuses a chatgpt model without a model id", () => {
    expect(errors(CHATGPT.replace("provider: chatgpt, model: m", "provider: chatgpt"))).toContain(
      '/models/reviewer: missing required key "model"',
    );
  });

  test("accepts an http backend URL with a port and path", () => {
    expect(ok(`${MODELS}backend: { url: "http://kerpeten.internal:8080/base" }\n`).backend?.url).toBe(
      "http://kerpeten.internal:8080/base",
    );
  });
});

describe("config_hash", () => {
  test("is the SHA-256 of the defaults-applied config with sorted keys", () => {
    const config = ok(MODELS);
    const { hash, ...rest } = config;

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(new ConfigLoader().hash(rest)).toBe(hash);
  });

  test("does not change with key order or with a default written out", () => {
    const base = ok(MODELS).hash;
    const reordered = `models:\n  judge: { model: some/model, provider: openrouter }\n  reviewer: { api_key_env: KIMI_API_KEY, base_url: "https://api.kimi.com/coding/v1", model: k3.1-pro, provider: anthropic }\n`;

    expect(ok(reordered).hash).toBe(base);
    expect(ok(`${MODELS}thresholds: { inline: 60 }\ncomment_language: tr\n`).hash).toBe(base);
  });

  test("changes when a value changes", () => {
    expect(ok(`${MODELS}thresholds: { inline: 61 }\n`).hash).not.toBe(ok(MODELS).hash);
    expect(ok(MODELS.replace("k3.1-pro", "k3.2-pro")).hash).not.toBe(ok(MODELS).hash);
  });
});

describe("ConfigLoader.load", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "kerpeten-config-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reads a file", () => {
    writeFileSync(join(dir, ".kerpeten.yml"), MODELS);
    expect(new ConfigLoader().load(join(dir, ".kerpeten.yml")).ok).toBe(true);
  });

  test("treats a missing file as invalid, since there is no default model", () => {
    const result = new ConfigLoader().load(join(dir, ".kerpeten.yml"));

    expect(result.ok).toBe(false);

    if (!result.ok) expect(result.errors.join("\n")).toContain("not found");
  });

  test("refuses a directory, a file that is not UTF-8 and an oversized file", () => {
    mkdirSync(join(dir, "d"));
    expect(new ConfigLoader().load(join(dir, "d")).ok).toBe(false);
    writeFileSync(join(dir, "bad.yml"), new Uint8Array([0x6d, 0x3a, 0x20, 0xff, 0xfe]));
    expect(new ConfigLoader().load(join(dir, "bad.yml")).ok).toBe(false);
    writeFileSync(join(dir, "big.yml"), `${MODELS}${" ".repeat(1_048_576)}\n`);
    expect(new ConfigLoader().load(join(dir, "big.yml")).ok).toBe(false);
  });

  function errorsOf(path: string): string {
    const result = new ConfigLoader().load(path);

    expect(result.ok).toBe(false);

    return result.ok ? "" : result.errors.join("\n");
  }

  test("separates the file path from the key that is wrong", () => {
    const path = join(dir, ".kerpeten.yml");

    writeFileSync(path, "models:\n  reviewer: { provider: anthropic, model: m }\n");
    expect(errorsOf(path)).toStartWith(`${path}: /models: `);
    writeFileSync(path, "- a\n");
    expect(errorsOf(path)).toStartWith(`${path}: `);
  });

  test("reports a file that is not UTF-8 as such", () => {
    writeFileSync(join(dir, "bad.yml"), new Uint8Array([0x6d, 0x3a, 0x20, 0xff, 0xfe]));
    expect(errorsOf(join(dir, "bad.yml"))).toContain("not UTF-8");
  });

  test.skipIf(process.getuid?.() === 0)("reports a file it may not read as unreadable, not as bad UTF-8", () => {
    const path = join(dir, ".kerpeten.yml");

    writeFileSync(path, MODELS);
    chmodSync(path, 0o000);

    try {
      const errors = errorsOf(path);

      expect(errors).toContain("cannot be read");
      expect(errors).toContain("EACCES");
      expect(errors).not.toContain("not UTF-8");
    } finally {
      chmodSync(path, 0o600);
    }
  });

  test("reports a path it cannot stat as unreadable instead of missing or throwing", () => {
    const path = join(dir, ".kerpeten.yml");

    symlinkSync(".kerpeten.yml", path);

    const errors = errorsOf(path);

    expect(errors).toContain("cannot be read");
    expect(errors).toContain("ELOOP");
  });

  test("a dangling symlink is still reported as missing", () => {
    const path = join(dir, ".kerpeten.yml");

    symlinkSync("nowhere.yml", path);
    expect(errorsOf(path)).toContain("not found");
  });
});

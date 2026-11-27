import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KerpetenApp } from "../../src/app/KerpetenApp.ts";
import { PermissionGroups } from "../../src/capability/PermissionGroups.ts";
import { RepoJail } from "../../src/capability/repo/RepoJail.ts";
import type { AiSdkSettings } from "../../src/harness-kit/ai-sdk/index.ts";
import { ExitCode, PermissionGroupSet } from "../../src/harness-kit/index.ts";
import { commit, sh, tempRepo, write } from "../capability/git/git-utils.ts";
import { mockClient } from "../harness-kit/harness-kit-utils.ts";

const SECRET = "sk-test-secret-value-123";

const KIMI_URL = "https://api.kimi.com/coding/v1";

const TRUSTED = { KERPETEN_TRUSTED_ENDPOINTS: `KIMI_API_KEY=${KIMI_URL}` };

const CONFIG = `models:
  reviewer: { provider: anthropic, model: k3.1-pro, base_url: "https://api.kimi.com/coding/v1", api_key_env: KIMI_API_KEY, max_output_tokens: 3000 }
  judge: { provider: anthropic, model: k3.1-judge, base_url: "https://api.kimi.com/coding/v1", api_key_env: KIMI_API_KEY, max_output_tokens: 2000 }
`;

const dirs: string[] = [];

const unjudged = { judge_error: expect.stringMatching(/^model_error: \S/), action: "stored" };

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });

  mock.restore();
});

function repo(config: string | null = CONFIG): string {
  const dir = tempRepo("kerpeten-cli-review-");

  dirs.push(dir);
  write(dir, { "src/a.ts": "export const a = 1;\n" });

  if (config !== null) write(dir, { ".kerpeten.yml": config });

  commit(dir, "base");
  sh(dir, ["checkout", "-q", "-b", "feature"]);
  write(dir, { "src/a.ts": "export const a = 1;\nexport const div = (x: number, y: number) => x / y;\n" });
  commit(dir, "add div");

  return dir;
}

const finding = {
  file: "src/a.ts",
  start_line: 2,
  end_line: 2,
  category: "bug",
  title: "Division by zero",
  body: "y can be 0",
  evidence: [{ location: "src/a.ts:2", note: "no guard" }],
};

async function run(
  cwd: string,
  argv: string[],
  env: Record<string, string> = { ...TRUSTED, KIMI_API_KEY: SECRET },
  script = [{ text: "done" }, { text: JSON.stringify({ findings: [finding] }) }],
  judgeScript: Parameters<typeof mockClient>[0] = [],
) {
  const out: string[] = [];
  const err: string[] = [];
  const created: AiSdkSettings[] = [];
  const reviewerMock = mockClient(script);
  const judgeMock = mockClient(judgeScript);

  const code = await KerpetenApp.run(
    {
      io: { out: (l) => out.push(l), err: (l) => err.push(l) },
      env: { ...env, PATH: process.env.PATH ?? "" },
      cwd,
      now: () => 0,
      createClient: (options) => {
        created.push(options);

        return created.length === 1 ? reviewerMock.client : judgeMock.client;
      },
    },
    argv,
  );

  return {
    code,
    out: out.join("\n"),
    err: err.join("\n"),
    created,
    calls: [...reviewerMock.calls, ...judgeMock.calls],
    reviewerCalls: reviewerMock.calls,
    judgeCalls: judgeMock.calls,
  };
}

describe("kerpeten review --dry-run", () => {
  test("prints a JSON finding list with the judge outcome and the usage per role", async () => {
    const dir = repo();
    const result = await run(dir, ["review", "--dry-run", "--base", "main", "--json"]);

    expect(result.code).toBe(0);

    const printed = JSON.parse(result.out);

    expect(printed.findings).toEqual([{ ...finding, ...unjudged }]);
    expect(printed.usage.map((entry: { role: string }) => entry.role)).toEqual(["reviewer", "judge"]);

    expect(result.created).toEqual([
      {
        provider: "anthropic",
        model: "k3.1-pro",
        apiKey: SECRET,
        baseUrl: "https://api.kimi.com/coding/v1",
        zdr: true,
        maxOutputTokens: 3000,
      },
      {
        provider: "anthropic",
        model: "k3.1-judge",
        apiKey: SECRET,
        baseUrl: "https://api.kimi.com/coding/v1",
        zdr: true,
        maxOutputTokens: 2000,
      },
    ]);

    expect(result.err).not.toContain(SECRET);
    expect(result.out).not.toContain(SECRET);
    expect(result.err).toContain("usage");
  });

  test("prints a readable list and marks a partial review", async () => {
    const dir = repo(`${CONFIG}limits: { max_tool_calls: 1 }\n`);

    const result = await run(dir, ["review", "--dry-run", "--base", "main"], { ...TRUSTED, KIMI_API_KEY: SECRET }, [
      {
        toolCalls: [
          { name: "read_file", input: { path: "src/a.ts" } },
          { name: "read_file", input: { path: "x" } },
        ],
      },
      { text: JSON.stringify({ findings: [finding] }) },
    ] as never);

    expect(result.code).toBe(0);
    expect(result.out).toContain("review: PARTIAL (tool_call_budget)");
    expect(result.out).toContain("- src/a.ts:2-2 [bug] Division by zero");
    expect(result.out).toContain("usage: reviewer anthropic/mock-model: 2 calls");
  });

  test("runs every tool, logs each call, model step and the final answer and prints the summary lines", async () => {
    const result = await run(repo(), ["review", "--dry-run", "--base", "main"], { ...TRUSTED, KIMI_API_KEY: SECRET }, [
      {
        toolCalls: [
          { name: "read_file", input: { path: "src/a.ts" } },
          { name: "list_dir", input: {} },
          { name: "grep", input: { pattern: "div" } },
          { name: "glob", input: { pattern: "**/*.ts" } },
          { name: "read_file", input: { path: "../x" } },
        ],
      },
      { text: "done" },
      { text: JSON.stringify({ findings: [finding] }) },
    ] as never);

    expect(result.code).toBe(0);
    expect(result.out).toMatch(/^review: [0-9a-f]{12}\.\.[0-9a-f]{12}, 1 changed files, prompt reviewer v2$/m);
    expect(result.out).toContain("findings: 1");
    expect(result.out).toContain("usage: reviewer anthropic/mock-model: 3 calls, 300 input tokens, 30 output tokens");
    expect(result.out).toContain("tool calls: 5");

    expect(result.err).toContain(
      `"review started" command=review mode=local-branch provider=anthropic model=k3.1-pro base_url=${KIMI_URL} config_hash=`,
    );

    const calls = result.err.split("\n").filter((line) => line.includes('"tool call"'));

    expect(calls.map((line) => line.slice(line.indexOf('"tool call"')))).toEqual([
      '"tool call" command=review harness=reviewer tool=read_file input="path=src/a.ts" ok=true calls=1',
      '"tool call" command=review harness=reviewer tool=list_dir input="" ok=true calls=2',
      '"tool call" command=review harness=reviewer tool=grep input="pattern=div" ok=true calls=3',
      '"tool call" command=review harness=reviewer tool=glob input="pattern=**/*.ts" ok=true calls=4',
      '"tool call" command=review harness=reviewer tool=read_file input="path=../x" ok=false calls=5',
    ]);

    const progress = result.err
      .split("\n")
      .filter((line) => /"(model step|final answer|reviewer ended)"/.test(line) && !line.includes("harness=judge"))
      .map((line) => line.slice(line.indexOf(" INFO ") + 6).replace(/ ms=\d+/, " ms=N"));

    expect(progress).toEqual([
      '"model step" command=review harness=reviewer step=1 ms=N input_tokens=100 output_tokens=10',
      '"model step" command=review harness=reviewer step=2 ms=N input_tokens=100 output_tokens=10',
      '"final answer" command=review harness=reviewer ok=true ms=N attempts=1 input_tokens=100 output_tokens=10',
      '"reviewer ended" command=review completed=true findings=1 steps=2 tool_calls=5 ms=N',
    ]);
  });

  test("a model that gives no result is a failure, not an empty review", async () => {
    const dir = repo();

    const result = await run(
      dir,
      ["review", "--dry-run", "--base", "main", "--json"],
      { ...TRUSTED, KIMI_API_KEY: SECRET },
      [{ error: new Error("401 invalid key") }, { error: new Error("401 invalid key") }] as never,
    );

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("the reviewer gave no result (model_error): 401 invalid key");
  });

  test("a review whose repository jail cannot be built fails with its error before any model call", async () => {
    const built = spyOn(RepoJail.prototype, "build").mockRejectedValue(new Error("the jail cannot be built"));

    const result = await run(
      repo(),
      ["review", "--dry-run", "--base", "main", "--json"],
      { ...TRUSTED, KIMI_API_KEY: SECRET },
      [
        { toolCalls: [{ name: "read_file", input: { path: "src/a.ts" } }] },
        { text: "done" },
        { text: JSON.stringify({ findings: [finding] }) },
      ] as never,
    );

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("kerpeten review: the jail cannot be built");
    expect(built).toHaveBeenCalledTimes(1);
    expect(result.reviewerCalls.length).toBe(0);
    expect(result.judgeCalls.length).toBe(0);
  });

  test("a partial review is reported on stderr even with --json", async () => {
    const dir = repo(`${CONFIG}limits: { max_tool_calls: 1 }\n`);

    const result = await run(
      dir,
      ["review", "--dry-run", "--base", "main", "--json"],
      { ...TRUSTED, KIMI_API_KEY: SECRET, KERPETEN_LOG_LEVEL: "error" },
      [
        {
          toolCalls: [
            { name: "read_file", input: { path: "src/a.ts" } },
            { name: "read_file", input: { path: "x" } },
          ],
        },
        { text: JSON.stringify({ findings: [finding] }) },
      ] as never,
    );

    expect(result.code).toBe(0);
    expect(JSON.parse(result.out).findings).toEqual([{ ...finding, ...unjudged }]);
    expect(result.err).toContain("kerpeten review: partial review (tool_call_budget)");
  });

  test("never passes control characters from model text to the terminal", async () => {
    const hostile = {
      ...finding,
      title: "Division\u001b[2J by zero\u009b31m",
      body: "y can be 0\u0007\u007f",
      evidence: [{ location: "src/a.ts:2\u001b]0;pwned\u0007", note: "no\u0085 guard\u001b[0m" }],
    };

    const dropped = { ...finding, file: "src/\u001b[31mx\u009b.ts" };
    const script = [{ text: "done" }, { text: JSON.stringify({ findings: [hostile, dropped] }) }];

    const control = (output: string) =>
      [...output].some((char) => {
        const code = char.charCodeAt(0);

        return (code < 0x20 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
      });

    const env = { ...TRUSTED, KIMI_API_KEY: SECRET, KERPETEN_LOG_LEVEL: "debug" };
    const text = await run(repo(), ["review", "--dry-run", "--base", "main"], env, script);

    expect(text.code).toBe(0);
    expect(text.out).toContain("- src/a.ts:2-2 [bug] Division�[2J by zero�31m");
    expect(text.out).toContain("  evidence src/a.ts:2�]0;pwned�: no� guard�[0m");
    expect(control(text.out)).toBe(false);
    expect(text.err).toContain("candidate finding dropped");
    expect(control(text.err)).toBe(false);

    const json = await run(repo(), ["review", "--dry-run", "--base", "main", "--json"], env, script);

    expect(control(json.out)).toBe(false);
    expect(control(json.err)).toBe(false);
    expect(JSON.parse(json.out).findings).toEqual([{ ...hostile, ...unjudged }]);
  });

  test("shows the labels, score and action or the judge error of every finding, in text and JSON", async () => {
    const second = { ...finding, start_line: 1, end_line: 1, title: "Export without a test" };

    const labels = {
      verdict: "verified",
      priority: "P1",
      nature: "edge_case",
      fix_effort: "easy",
      rationale: "y is\u001b[2J never checked",
      evidence: [{ location: "src/a.ts:2" }],
    };

    const config = `${CONFIG}limits: { max_judge_parallel: 1 }\n`;
    const reviewer = [{ text: "done" }, { text: JSON.stringify({ findings: [finding, second] }) }];

    const judge = [
      { toolCalls: [{ name: "read_file", input: { path: "src/a.ts" } }] },
      { text: "done" },
      { text: JSON.stringify(labels) },
    ] as never;

    const env = { ...TRUSTED, KIMI_API_KEY: SECRET };
    const text = await run(repo(config), ["review", "--dry-run", "--base", "main"], env, reviewer, judge);

    expect(text.code).toBe(0);

    expect(text.out).toContain(
      "- src/a.ts:2-2 [bug] Division by zero\n  verdict verified, priority P1, nature edge_case, fix_effort easy, score 50, action summary\n  y can be 0\n  rationale y is�[2J never checked",
    );

    expect(text.out).toMatch(
      /- src\/a\.ts:1-1 \[bug\] Export without a test\n {2}judge_error model_error: \S.*, action stored\n/,
    );

    expect(text.out).not.toContain("\u001b");
    expect(text.out).toContain("usage: reviewer anthropic/mock-model: 2 calls");
    expect(text.out).toMatch(/^usage: judge anthropic\/mock-model: 5 calls, 300 input tokens, 30 output tokens$/m);
    expect(text.out).toMatch(/^judge tool calls: 1$/m);

    const json = await run(repo(config), ["review", "--dry-run", "--base", "main", "--json"], env, reviewer, judge);
    const printed = JSON.parse(json.out);

    expect(json.code).toBe(0);

    expect(printed.findings).toEqual([
      {
        ...finding,
        verdict: "verified",
        priority: "P1",
        nature: "edge_case",
        fix_effort: "easy",
        rationale: labels.rationale,
        score: 50,
        action: "summary",
      },
      { ...second, ...unjudged },
    ]);

    expect(printed.usage).toEqual([
      expect.objectContaining({ role: "reviewer", provider: "anthropic", model: "mock-model", calls: 2 }),
      expect.objectContaining({
        role: "judge",
        provider: "anthropic",
        model: "mock-model",
        calls: 5,
        input_tokens: 300,
        output_tokens: 30,
      }),
    ]);
  });

  test("the judge runs on its own client built from models.judge", async () => {
    const labels = {
      verdict: "verified",
      priority: "P1",
      nature: "edge_case",
      fix_effort: "easy",
      rationale: "y is never checked",
      evidence: [{ location: "src/a.ts:2" }],
    };

    const config =
      'models:\n  reviewer: { provider: anthropic, model: r }\n  judge: { provider: openai, model: j, base_url: "https://judge.example/v1", api_key_env: JUDGE_API_KEY, effort: low }\n';

    const result = await run(
      repo(config),
      ["review", "--dry-run", "--base", "main", "--json"],
      {
        ANTHROPIC_API_KEY: SECRET,
        JUDGE_API_KEY: "judge-secret",
        KERPETEN_TRUSTED_ENDPOINTS: "JUDGE_API_KEY=https://judge.example/v1",
      },
      undefined,
      [{ text: "done" }, { text: JSON.stringify(labels) }],
    );

    expect(result.code).toBe(0);

    expect(result.created).toEqual([
      { provider: "anthropic", model: "r", apiKey: SECRET, zdr: true, maxOutputTokens: 16000 },
      {
        provider: "openai",
        model: "j",
        apiKey: "judge-secret",
        baseUrl: "https://judge.example/v1",
        zdr: true,
        maxOutputTokens: 16000,
        effort: "low",
      },
    ]);

    expect(result.reviewerCalls.length).toBe(2);
    expect(result.judgeCalls.length).toBe(2);
    expect(result.err).toContain("judge_provider=openai judge_model=j");
  });

  test("works from a subdirectory of the repository", async () => {
    const dir = repo();
    const result = await run(join(dir, "src"), ["review", "--dry-run", "--base", "main", "--json"]);

    expect(result.code).toBe(0);
  });

  const failures: [string, string | null, string[], Record<string, string>, number, string][] = [
    [
      "a missing configuration",
      null,
      ["--base", "main"],
      { ...TRUSTED, KIMI_API_KEY: SECRET },
      2,
      "invalid configuration",
    ],
    [
      "a configuration without a judge",
      "models:\n  reviewer: { provider: anthropic, model: m }\n",
      ["--base", "main"],
      {},
      2,
      "judge",
    ],
    ["a missing key", CONFIG, ["--base", "main"], { ...TRUSTED }, 2, "set KIMI_API_KEY"],
    [
      "a missing judge key",
      "models:\n  reviewer: { provider: anthropic, model: m }\n  judge: { provider: openai, model: m }\n",
      ["--base", "main"],
      { ANTHROPIC_API_KEY: SECRET },
      2,
      "the judge API key is missing; set OPENAI_API_KEY",
    ],
    ["an empty key", CONFIG, ["--base", "main"], { ...TRUSTED, KIMI_API_KEY: "  " }, 2, "set KIMI_API_KEY"],
    ["no base and no origin/HEAD", CONFIG, [], { ...TRUSTED, KIMI_API_KEY: SECRET }, 2, "pass --base"],
    [
      "a base that does not exist",
      CONFIG,
      ["--base", "nope"],
      { ...TRUSTED, KIMI_API_KEY: SECRET },
      2,
      "cannot use nope",
    ],
    [
      "--full",
      CONFIG,
      ["--base", "main", "--full"],
      { ...TRUSTED, KIMI_API_KEY: SECRET },
      2,
      "--full is not supported in this build",
    ],
    [
      "a scoring weight above 100",
      `${CONFIG}scoring: { priority: { P0: 101 } }\n`,
      ["--base", "main"],
      { ...TRUSTED, KIMI_API_KEY: SECRET },
      2,
      ".kerpeten.yml: /scoring/priority/P0",
    ],
    [
      "a summary threshold above the inline threshold",
      `${CONFIG}thresholds: { inline: 20, summary: 60 }\n`,
      ["--base", "main"],
      { ...TRUSTED, KIMI_API_KEY: SECRET },
      2,
      ".kerpeten.yml: /thresholds: summary must not be above inline",
    ],
    [
      "a missing context file",
      CONFIG,
      ["--base", "main", "--context-file", "/nonexistent/x.json"],
      { ...TRUSTED, KIMI_API_KEY: SECRET },
      2,
      "cannot be read",
    ],
  ];

  for (const [name, config, args, env, code, message] of failures) {
    test(`refuses ${name}`, async () => {
      const dir = repo(config);
      const result = await run(dir, ["review", "--dry-run", ...args], env);

      expect(result.code).toBe(code);
      expect(result.err).toContain(message);
      expect(result.calls.length).toBe(0);
      expect(result.err).not.toContain(SECRET);
    });
  }

  test("uses the provider's default key variable when api_key_env is not set", async () => {
    const dir = repo("models:\n  reviewer: { provider: openai, model: m }\n  judge: { provider: openai, model: m }\n");

    expect(
      (await run(dir, ["review", "--dry-run", "--base", "main"], { ...TRUSTED, KIMI_API_KEY: SECRET })).err,
    ).toContain("set OPENAI_API_KEY");

    const ok = await run(dir, ["review", "--dry-run", "--base", "main", "--json"], { OPENAI_API_KEY: SECRET });

    expect(ok.code).toBe(0);
    expect(ok.created[0]).toMatchObject({ provider: "openai", apiKey: SECRET, maxOutputTokens: 16000 });
    expect(ok.created[0]?.baseUrl).toBeUndefined();
  });

  const untrusted: [string, string, Record<string, string>, string][] = [
    [
      "a foreign base_url with another provider's key",
      'models:\n  reviewer: { provider: openai, model: m, base_url: "https://collector.example", api_key_env: OPENAI_API_KEY }\n  judge: { provider: openai, model: m }\n',
      { OPENAI_API_KEY: SECRET },
      '"OPENAI_API_KEY=https://collector.example"',
    ],
    [
      "a base_url with the provider's default key",
      'models:\n  reviewer: { provider: anthropic, model: m, base_url: "https://collector.example" }\n  judge: { provider: anthropic, model: m }\n',
      { ANTHROPIC_API_KEY: SECRET },
      '"ANTHROPIC_API_KEY=https://collector.example"',
    ],
    [
      "an unrelated key sent to the default endpoint",
      "models:\n  reviewer: { provider: openai, model: m, api_key_env: STRIPE_API_KEY }\n  judge: { provider: openai, model: m }\n",
      { STRIPE_API_KEY: SECRET },
      '"STRIPE_API_KEY=openai"',
    ],
    ["the Kimi endpoint with no confirmation", CONFIG, { KIMI_API_KEY: SECRET }, `"KIMI_API_KEY=${KIMI_URL}"`],
    [
      "a judge on a foreign base_url",
      'models:\n  reviewer: { provider: anthropic, model: m }\n  judge: { provider: anthropic, model: m, base_url: "https://collector.example" }\n',
      { ANTHROPIC_API_KEY: SECRET },
      '"ANTHROPIC_API_KEY=https://collector.example"',
    ],
    [
      "a confirmation for another URL",
      CONFIG,
      { KIMI_API_KEY: SECRET, KERPETEN_TRUSTED_ENDPOINTS: "KIMI_API_KEY=https://api.kimi.com/other" },
      `"KIMI_API_KEY=${KIMI_URL}"`,
    ],
    [
      "a confirmation for another key name",
      CONFIG,
      { KIMI_API_KEY: SECRET, KERPETEN_TRUSTED_ENDPOINTS: `OPENAI_API_KEY=${KIMI_URL}` },
      `"KIMI_API_KEY=${KIMI_URL}"`,
    ],
    [
      "a confirmation that only starts with the URL",
      CONFIG,
      { KIMI_API_KEY: SECRET, KERPETEN_TRUSTED_ENDPOINTS: `KIMI_API_KEY=${KIMI_URL}/x` },
      `"KIMI_API_KEY=${KIMI_URL}"`,
    ],
  ];

  for (const [name, config, env, entry] of untrusted) {
    test(`does not send a key for ${name}`, async () => {
      const dir = repo(config);
      const result = await run(dir, ["review", "--dry-run", "--base", "main"], env);

      expect(result.code).toBe(2);
      expect(result.err).toContain("KERPETEN_TRUSTED_ENDPOINTS");
      expect(result.err).toContain(entry);
      expect(result.created).toEqual([]);
      expect(result.calls.length).toBe(0);
      expect(result.err).not.toContain(SECRET);
      expect(result.out).not.toContain(SECRET);
    });
  }

  test("sends the key once the operator lists the exact key and endpoint", async () => {
    const config =
      'models:\n  reviewer: { provider: openai, model: m, base_url: "https://llm.example/v1", api_key_env: STRIPE_API_KEY }\n  judge: { provider: openai, model: m }\n';

    const dir = repo(config);

    const result = await run(dir, ["review", "--dry-run", "--base", "main", "--json"], {
      STRIPE_API_KEY: SECRET,
      OPENAI_API_KEY: SECRET,
      KERPETEN_TRUSTED_ENDPOINTS: `  OTHER_API_KEY=anthropic\n STRIPE_API_KEY=https://llm.example/v1 ,KIMI_API_KEY=${KIMI_URL}`,
    });

    expect(result.code).toBe(0);
    expect(result.created[0]).toMatchObject({ apiKey: SECRET, baseUrl: "https://llm.example/v1" });
  });

  test("a custom key name for the default endpoint is confirmed with the provider name", async () => {
    const config =
      "models:\n  reviewer: { provider: openai, model: m, api_key_env: TEAM_OPENAI_API_KEY }\n  judge: { provider: openai, model: m }\n";

    const dir = repo(config);

    const result = await run(dir, ["review", "--dry-run", "--base", "main", "--json"], {
      TEAM_OPENAI_API_KEY: SECRET,
      OPENAI_API_KEY: SECRET,
      KERPETEN_TRUSTED_ENDPOINTS: "TEAM_OPENAI_API_KEY=openai",
    });

    expect(result.code).toBe(0);
    expect(result.created[0]).toMatchObject({ apiKey: SECRET });
    expect(result.created[0]?.baseUrl).toBeUndefined();
  });

  test("a directory outside git is refused", async () => {
    const dir = tempRepo("kerpeten-cli-nogit-");

    dirs.push(dir);
    rmSync(join(dir, ".git"), { recursive: true, force: true });
    writeFileSync(join(dir, ".kerpeten.yml"), CONFIG);

    const result = await run(dir, ["review", "--dry-run", "--base", "main"]);

    expect(result.code).toBe(2);
    expect(result.err).toContain("not inside a git work tree");
  });

  test("starts the review with the permission group of the flag", async () => {
    const result = await run(repo(), ["review", "--dry-run", "--base", "main", "--json", "--read"], undefined, [
      { text: "done" },
      { text: '{"findings":[]}' },
    ]);

    expect(result.code).toBe(0);
    expect(result.err).toContain('"permission group" command=review group=read permissions="repo:read, repo:search"');
    expect(result.calls.length).toBe(2);
    expect(result.judgeCalls.length).toBe(0);
    expect(JSON.parse(result.out)).toEqual({ findings: [], usage: [expect.objectContaining({ role: "reviewer" })] });
  });

  test("starts the review with the all group when no group flag is given", async () => {
    const result = await run(repo(), ["review", "--dry-run", "--base", "main", "--json"]);

    expect(result.code).toBe(0);
    expect(result.err).toContain('"permission group" command=review group=all permissions="repo:read, repo:search"');
  });

  test("refuses a permission group that misses a permission a harness needs, before any model call", async () => {
    const paths = new PermissionGroupSet({ paths: ["repo:read"] }).grant("paths");

    spyOn(PermissionGroups.SET, "grant").mockReturnValue(paths);

    const result = await run(repo(), ["review", "--dry-run", "--base", "main", "--read"]);

    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.err).toContain('the permission group "paths" cannot start this run:');
    expect(result.err).toContain("- harness reviewer needs the permission repo:search");
    expect(result.err).toContain("- harness judge needs the permission repo:search");
    expect(result.out).toBe("");
    expect(result.calls.length).toBe(0);
  });

  for (const flags of [
    ["--all", "--read"],
    ["--read", "--all"],
  ]) {
    test(`refuses ${flags.join(" ")} before any model call`, async () => {
      const result = await run(repo(), ["review", "--dry-run", "--base", "main", ...flags]);

      expect(result.code).toBe(2);
      expect(result.err).toContain("give at most one permission group flag");
      expect(result.created).toEqual([]);
      expect(result.calls.length).toBe(0);
    });
  }

  test("refuses an unknown flag before any model call", async () => {
    const result = await run(repo(), ["review", "--dry-run", "--base", "main", "--write"]);

    expect(result.code).toBe(2);
    expect(result.err).toContain("--write");
    expect(result.created).toEqual([]);
    expect(result.calls.length).toBe(0);
  });

  test("review without --dry-run is not implemented yet", async () => {
    const dir = repo();
    const result = await run(dir, ["review", "--base", "main"]);

    expect(result.code).toBe(1);
    expect(result.calls.length).toBe(0);
  });
});

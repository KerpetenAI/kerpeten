import { afterEach, describe, expect, test } from "bun:test";
import { realpathSync, rmSync } from "node:fs";
import type { AiSdkSettings } from "@kerpetensh/harness-kit/ai-sdk";
import { KerpetenApp } from "../../src/app/KerpetenApp.ts";
import { ConfigLoader } from "../../src/capability/config/ConfigLoader.ts";
import { commit, sh, tempRepo, write } from "../capability/git/git-utils.ts";
import { mockClient } from "../test-utils.ts";

const ANSWER = [{ text: "done" }, { text: JSON.stringify({ findings: [] }) }];

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(config: string): string {
  const dir = tempRepo("kerpeten-effort-");

  dirs.push(dir);
  write(dir, { "src/a.ts": "export const a = 1;\n", ".kerpeten.yml": config });
  commit(dir, "base");
  sh(dir, ["checkout", "-q", "-b", "feature"]);
  write(dir, { "src/a.ts": "export const a = 2;\n" });
  commit(dir, "change");

  return dir;
}

async function review(config: string) {
  const created: AiSdkSettings[] = [];
  const err: string[] = [];
  const dir = repo(config);

  const code = await KerpetenApp.run(
    {
      io: { out: () => {}, err: (line) => err.push(line) },
      env: { OPENAI_API_KEY: "test-key", PATH: process.env.PATH ?? "" },
      cwd: dir,
      now: () => 0,
      createClient: (settings) => {
        created.push(settings);

        return mockClient(ANSWER).client;
      },
    },
    ["review", "--dry-run", "--base", "main", "--json"],
  );

  return { code, created, err: err.map((line) => line.replaceAll(realpathSync(dir), "<repo>")) };
}

describe("models.<role>.effort", () => {
  test("the reviewer and judge efforts reach their model settings", async () => {
    for (const effort of ["low", "medium", "high"] as const) {
      const result = await review(
        `models:\n  reviewer: { provider: openai, model: m, effort: ${effort} }\n  judge: { provider: openai, model: m, effort: high }\n`,
      );

      expect(result.code).toBe(0);
      expect(result.created.map((settings) => settings.effort)).toEqual([effort, "high"]);
    }
  });

  test("without effort the model settings carry no effort key", async () => {
    const result = await review(
      "models:\n  reviewer: { provider: openai, model: m }\n  judge: { provider: openai, model: m }\n",
    );

    expect(result.code).toBe(0);
    expect(result.created.map((settings) => Object.hasOwn(settings, "effort"))).toEqual([false, false]);
  });

  test("the judge accepts an effort too", () => {
    const result = new ConfigLoader().parse(
      "models:\n  reviewer: { provider: openrouter, model: m }\n  judge: { provider: anthropic, model: m, effort: low }\n",
    );

    expect(result.ok && result.config.models.judge.effort).toBe("low");
  });

  test("an effort outside low, medium and high is a configuration error", async () => {
    const result = await review(
      "models:\n  reviewer: { provider: openai, model: m, effort: max }\n  judge: { provider: openai, model: m, effort: 3 }\n",
    );

    expect(result.code).toBe(2);
    expect(result.created).toEqual([]);

    expect(result.err.filter((line) => line.includes("/effort"))).toEqual([
      'kerpeten review: invalid configuration: <repo>/.kerpeten.yml: /models/reviewer/effort: Invalid option: expected one of "low"|"medium"|"high"',
      'kerpeten review: invalid configuration: <repo>/.kerpeten.yml: /models/judge/effort: Invalid option: expected one of "low"|"medium"|"high"',
    ]);
  });
});

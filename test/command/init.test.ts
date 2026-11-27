import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KerpetenApp } from "../../src/app/KerpetenApp.ts";
import { ConfigFileWriter } from "../../src/capability/config/ConfigFileWriter.ts";
import { ConfigLoader } from "../../src/capability/config/ConfigLoader.ts";
import { ExitCode } from "../../src/harness-kit/index.ts";
import { plan, signIn, tempHome } from "../capability/chatgpt/chatgpt-utils.ts";
import { FakeChatGpt } from "../capability/chatgpt/FakeChatGpt.ts";
import { tempRepo } from "../capability/git/git-utils.ts";
import type { CountedStdin, InitResult, InitRun } from "./types/init.ts";

const KEY = "sk-init-test-key-value-7f3a";

const PROVIDER_LIST = [
  "  1. ChatGPT plan (chatgpt)",
  "  2. Anthropic, with an API key",
  "  3. OpenAI, with an API key",
  "  4. OpenRouter, with an API key",
];

const dirs: string[] = [];

let fake: FakeChatGpt;

beforeEach(() => {
  fake = new FakeChatGpt();
});

afterEach(() => {
  fake.stop();
});

afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
  const dir = tempRepo("kerpeten-init-");

  dirs.push(dir);

  return dir;
}

function bin(withRipgrep: boolean): string {
  const dir = tempHome(dirs);

  if (withRipgrep) writeFileSync(join(dir, "rg"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  return dir;
}

function answers(...lines: string[]): CountedStdin {
  let opened = 0;

  return {
    stdin: () => {
      opened += 1;

      return new Blob([lines.map((line) => `${line}\n`).join("")]).stream();
    },
    opened: () => opened,
  };
}

function setup(cwd: string, stdin: CountedStdin, more: Partial<InitRun> = {}): InitRun {
  return { cwd, home: tempHome(dirs), path: bin(true), stdin: stdin.stdin, ...more };
}

async function init(run: InitRun): Promise<InitResult> {
  const out: string[] = [];
  const err: string[] = [];

  const code = await KerpetenApp.run(
    {
      io: { out: (line) => out.push(line), err: (line) => err.push(line) },
      env: { HOME: run.home, PATH: run.path, ...run.env },
      cwd: run.cwd,
      chatgpt: fake.endpoints,
      stdin: run.stdin,
    },
    ["init"],
  );

  return { code, out: out.join("\n"), err: err.join("\n"), lines: out };
}

async function signedInHome(): Promise<string> {
  const home = tempHome(dirs);

  await signIn(fake, await plan(fake, home));

  return home;
}

function configText(dir: string): string {
  return readFileSync(join(dir, ".kerpeten.yml"), "utf8");
}

function loaded(dir: string) {
  const result = new ConfigLoader().load(join(dir, ".kerpeten.yml"));

  if (!result.ok) throw new Error(result.errors.join("\n"));

  return result.config;
}

function yaml(reviewer: string, judge: string, language: string): string {
  const [reviewerProvider, reviewerModel] = reviewer.split(" ");
  const [judgeProvider, judgeModel] = judge.split(" ");

  return [
    "models:",
    "  reviewer:",
    `    provider: ${reviewerProvider}`,
    `    model: ${reviewerModel}`,
    "  judge:",
    `    provider: ${judgeProvider}`,
    `    model: ${judgeModel}`,
    `comment_language: ${language}`,
    "",
  ].join("\n");
}

describe("kerpeten init", () => {
  const typed: [string, string, string][] = [
    ["2", "anthropic", "claude-test-1"],
    ["3", "openai", "gpt-test-1"],
    ["4", "openrouter", "vendor/model-test-1"],
  ];

  for (const [number, provider, model] of typed) {
    test(`writes the file for ${provider} with a typed model id, and the file loads`, async () => {
      const dir = repo();
      const result = await init(setup(dir, answers(number, model, "y", "en")));

      expect(result.code).toBe(ExitCode.OK);
      expect(result.err).toBe("");
      expect(configText(dir)).toBe(yaml(`${provider} ${model}`, `${provider} ${model}`, "en"));

      const config = loaded(dir);

      expect(config.models.reviewer).toEqual({ provider, model } as typeof config.models.reviewer);
      expect(config.models.judge).toEqual(config.models.reviewer);
      expect(config.comment_language).toBe("en");
    });
  }

  test("asks the questions in order and prints the setup check and the next steps", async () => {
    const dir = repo();

    const result = await init(
      setup(dir, answers("2", "claude-test-1", "y", "en"), { env: { ANTHROPIC_API_KEY: KEY } }),
    );

    expect(result.lines).toEqual([
      `kerpeten init writes .kerpeten.yml to ${dir}. Answer each question on its own line.`,
      "Provider of the reviewer:",
      ...PROVIDER_LIST,
      "Number [1-4]:",
      "Model id of the reviewer:",
      "Should the judge use the same provider and model as the reviewer? [y/n]",
      "Language of the review comments, as a tag such as en, tr or de:",
      `Wrote ${join(dir, ".kerpeten.yml")}.`,
      "",
      "Setup check:",
      "  ok: ripgrep (rg) is on PATH",
      "  ok: ANTHROPIC_API_KEY is set (reviewer and judge)",
      "",
      "Next: kerpeten review --dry-run",
      "Commit .kerpeten.yml so that everyone on the project reviews with the same settings.",
    ]);
  });

  test("a judge with its own provider and model", async () => {
    const dir = repo();
    const result = await init(setup(dir, answers("2", "claude-test-1", "n", "3", "gpt-test-1", "tr")));

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("Provider of the judge:");
    expect(result.out).toContain("Model id of the judge:");
    expect(configText(dir)).toBe(yaml("anthropic claude-test-1", "openai gpt-test-1", "tr"));
    expect(loaded(dir).models.judge).toEqual({ provider: "openai", model: "gpt-test-1" });
  });

  test("chatgpt with a sign-in lists the models of the plan, picked by number, and fetches the list once", async () => {
    const dir = repo();
    const home = await signedInHome();
    const result = await init(setup(dir, answers("1", "1", "n", "1", "1", "en"), { home }));

    expect(result.code).toBe(ExitCode.OK);

    expect(result.out).toContain(
      "Model of the reviewer, from your ChatGPT plan:\n  1. plan-model (Plan Model)\nNumber [1-1]:",
    );

    expect(result.out).toContain("Model of the judge, from your ChatGPT plan:");
    expect(result.out).not.toContain("hidden-model");
    expect(result.out).not.toContain("Model id of the");
    expect(fake.requests("/v1/models")).toHaveLength(1);
    expect(configText(dir)).toBe(yaml("chatgpt plan-model", "chatgpt plan-model", "en"));
    expect(loaded(dir).models.reviewer).toEqual({ provider: "chatgpt", model: "plan-model" });
    expect(result.out).toContain("  ok: signed in to ChatGPT (reviewer and judge)");

    for (const secret of fake.issuedTokens) expect(result.out + result.err).not.toContain(secret);
  });

  test("chatgpt without a sign-in says so in one line and takes a typed model id", async () => {
    const dir = repo();
    const result = await init(setup(dir, answers("1", "typed-model", "y", "en")));

    expect(result.code).toBe(ExitCode.OK);

    expect(result.out).toContain(
      "Not signed in to ChatGPT, so the models of your plan cannot be listed; `kerpeten auth login` makes the list available.\nModel id of the reviewer:",
    );

    expect(fake.requests("/v1/models")).toHaveLength(0);
    expect(configText(dir)).toBe(yaml("chatgpt typed-model", "chatgpt typed-model", "en"));
    expect(result.out).toContain("  missing: not signed in to ChatGPT (reviewer and judge); run `kerpeten auth login`");
  });

  test("chatgpt with a sign-in whose model list cannot be fetched takes a typed model id", async () => {
    const dir = repo();
    const home = await signedInHome();

    fake.stop();

    const result = await init(setup(dir, answers("1", "typed-model", "y", "en"), { home }));

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("The models of your ChatGPT plan cannot be listed (");
    expect(result.out).toContain("; `kerpeten auth login` makes the list available.\nModel id of the reviewer:");
    expect(configText(dir)).toBe(yaml("chatgpt typed-model", "chatgpt typed-model", "en"));
  });

  test("an existing .kerpeten.yml is not touched and no question is asked", async () => {
    const dir = repo();
    const stdin = answers("2", "claude-test-1", "y", "en");

    writeFileSync(join(dir, ".kerpeten.yml"), "hand: written\n");

    const result = await init(setup(dir, stdin));

    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.out).toBe("");

    expect(result.err).toBe(
      `kerpeten init: ${join(dir, ".kerpeten.yml")} already exists; init does not change it. Edit it by hand, or remove it and run \`kerpeten init\` again`,
    );

    expect(configText(dir)).toBe("hand: written\n");
    expect(stdin.opened()).toBe(0);
  });

  test("a link at .kerpeten.yml is not followed, whether it points to a file or nowhere", async () => {
    const outside = tempHome(dirs);
    const target = join(outside, "target.yml");

    writeFileSync(target, "outside: file\n");

    for (const pointsTo of [target, join(outside, "missing.yml")]) {
      const dir = repo();
      const stdin = answers("2", "claude-test-1", "y", "en");

      symlinkSync(pointsTo, join(dir, ".kerpeten.yml"));

      const result = await init(setup(dir, stdin));

      expect(result.code).toBe(ExitCode.USAGE);
      expect(result.err).toContain("already exists; init does not change it");
      expect(stdin.opened()).toBe(0);
      expect(lstatSync(join(dir, ".kerpeten.yml")).isSymbolicLink()).toBe(true);
    }

    expect(readFileSync(target, "utf8")).toBe("outside: file\n");
    expect(existsSync(join(outside, "missing.yml"))).toBe(false);
  });

  test("the writer creates the file exclusively and never writes through a link", () => {
    const writer = new ConfigFileWriter();
    const outside = tempHome(dirs);
    const target = join(outside, "target.yml");
    const dir = repo();

    writeFileSync(target, "outside: file\n");
    symlinkSync(target, join(dir, ".kerpeten.yml"));

    expect(() => writer.create(dir, "models: {}\n")).toThrow("already exists; init does not change it");
    expect(readFileSync(target, "utf8")).toBe("outside: file\n");

    const dangling = repo();

    symlinkSync(join(outside, "missing.yml"), join(dangling, ".kerpeten.yml"));

    expect(() => writer.create(dangling, "models: {}\n")).toThrow("already exists; init does not change it");
    expect(existsSync(join(outside, "missing.yml"))).toBe(false);

    const fresh = repo();

    expect(writer.create(fresh, "a: 1\n")).toBe(join(fresh, ".kerpeten.yml"));
    expect(() => writer.create(fresh, "b: 2\n")).toThrow("already exists; init does not change it");
    expect(configText(fresh)).toBe("a: 1\n");
  });

  test("outside a git repository it ends with an error, asks nothing and writes no file", async () => {
    const dir = tempHome(dirs);
    const stdin = answers("2", "claude-test-1", "y", "en");
    const result = await init(setup(dir, stdin));

    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.out).toBe("");

    expect(result.err).toContain(
      "is not inside a git work tree; run `kerpeten init` inside the repository you want to review",
    );

    expect(stdin.opened()).toBe(0);
    expect(existsSync(join(dir, ".kerpeten.yml"))).toBe(false);
  });

  test("a .kerpeten.yml that appears while the questions are asked is not overwritten and ends init with 1", async () => {
    const dir = repo();
    const given = answers("2", "claude-test-1", "y", "en");

    const stdin = () => {
      writeFileSync(join(dir, ".kerpeten.yml"), "raced: in\n");

      return given.stdin();
    };

    const result = await init(setup(dir, given, { stdin }));

    expect(result.code).toBe(ExitCode.FAILED);

    expect(result.err).toBe(
      `kerpeten init: ${join(dir, ".kerpeten.yml")} already exists; init does not change it. Edit it by hand, or remove it and run \`kerpeten init\` again`,
    );

    expect(result.out).not.toContain("Wrote");
    expect(result.out).not.toContain("Setup check:");
    expect(configText(dir)).toBe("raced: in\n");
  });

  test("standard input that ends before the last answer is a usage error and writes no file", async () => {
    const dir = repo();
    const result = await init(setup(dir, answers("2", "claude-test-1", "y")));

    expect(result.code).toBe(ExitCode.USAGE);

    expect(result.err).toBe(
      "kerpeten init: standard input ended before every question was answered; no file was written",
    );

    expect(existsSync(join(dir, ".kerpeten.yml"))).toBe(false);
  });

  test("standard input that is not UTF-8 is a usage error and writes no file", async () => {
    const dir = repo();

    const result = await init(
      setup(dir, answers("2", "claude-test-1", "y"), {
        stdin: () => new Blob([new Uint8Array([0x32, 0x0a, 0xff, 0x0a])]).stream(),
      }),
    );

    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.err).toBe("kerpeten init: standard input is not UTF-8 text; no file was written");
    expect(existsSync(join(dir, ".kerpeten.yml"))).toBe(false);
  });

  test("an answer that is not valid is asked again with a short reason", async () => {
    const dir = repo();

    const stdin = answers(
      "0",
      "5",
      "two",
      "2",
      "",
      "has space",
      "x".repeat(201),
      "x".repeat(2000),
      "claude-test-1",
      "maybe",
      "Y",
      "",
      "EN",
      "en_US",
      "pt-BR",
    );

    const result = await init(setup(dir, stdin));

    expect(result.code).toBe(ExitCode.OK);

    const reasons = result.lines.filter(
      (line) =>
        line.startsWith("Type") || line.startsWith("An ") || line.startsWith("A ") || line.startsWith("The answer"),
    );

    expect(reasons).toEqual([
      "Type a number from 1 to 4.",
      "Type a number from 1 to 4.",
      "Type a number from 1 to 4.",
      "An answer is needed.",
      "A model id is one word, without spaces or control characters, of at most 200 characters.",
      "A model id is one word, without spaces or control characters, of at most 200 characters.",
      "The answer is too long.",
      "Type y or n.",
      "An answer is needed.",
      "A language tag looks like en, tr or pt-BR.",
      "A language tag looks like en, tr or pt-BR.",
    ]);

    expect(result.lines.filter((line) => line === "Number [1-4]:")).toHaveLength(4);
    expect(configText(dir)).toBe(yaml("anthropic claude-test-1", "anthropic claude-test-1", "pt-BR"));
  });

  test("a model id and a language that YAML would read as other types stay strings", async () => {
    const dir = repo();
    const result = await init(setup(dir, answers("3", "123", "n", "4", "true", "no")));

    expect(result.code).toBe(ExitCode.OK);

    const config = loaded(dir);

    expect(config.models.reviewer).toEqual({ provider: "openai", model: "123" });
    expect(config.models.judge).toEqual({ provider: "openrouter", model: "true" });
    expect(config.comment_language).toBe("no");
  });

  test("each question is printed before its answer is read", async () => {
    const dir = repo();
    const out: string[] = [];
    const lastLines: string[] = [];
    const lines = ["2", "claude-test-1", "y", "en"];

    const stdin = () =>
      new ReadableStream<Uint8Array>(
        {
          pull: (controller) => {
            const line = lines.shift();

            lastLines.push(out.at(-1) ?? "");

            if (line === undefined) controller.close();
            else controller.enqueue(new TextEncoder().encode(`${line}\n`));
          },
        },
        { highWaterMark: 0 },
      );

    const code = await KerpetenApp.run(
      {
        io: { out: (line) => out.push(line), err: () => {} },
        env: { HOME: tempHome(dirs), PATH: bin(true) },
        cwd: dir,
        chatgpt: fake.endpoints,
        stdin,
      },
      ["init"],
    );

    expect(code).toBe(ExitCode.OK);

    expect(lastLines.slice(0, 4)).toEqual([
      "Number [1-4]:",
      "Model id of the reviewer:",
      "Should the judge use the same provider and model as the reviewer? [y/n]",
      "Language of the review comments, as a tag such as en, tr or de:",
    ]);
  });
});

describe("kerpeten init setup check", () => {
  test("a key variable that is set and ripgrep on PATH are ok, and the key value is never printed", async () => {
    const dir = repo();

    const result = await init(
      setup(dir, answers("2", "claude-test-1", "n", "4", "vendor/model", "en"), {
        env: { ANTHROPIC_API_KEY: KEY, OPENROUTER_API_KEY: KEY },
      }),
    );

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("  ok: ripgrep (rg) is on PATH");
    expect(result.out).toContain("  ok: ANTHROPIC_API_KEY is set (reviewer)");
    expect(result.out).toContain("  ok: OPENROUTER_API_KEY is set (judge)");
    expect(result.out + result.err).not.toContain(KEY);
  });

  test("a missing key variable and ripgrep missing from PATH are reported with the fix, and the command still ends with 0", async () => {
    const dir = repo();

    const result = await init(
      setup(dir, answers("3", "gpt-test-1", "y", "en"), { path: bin(false), env: { OPENAI_API_KEY: "  " } }),
    );

    expect(result.code).toBe(ExitCode.OK);

    expect(result.out).toContain(
      "  missing: ripgrep (rg) is not on PATH; install it: https://github.com/BurntSushi/ripgrep",
    );

    expect(result.out).toContain(
      "  missing: OPENAI_API_KEY is not set (reviewer and judge); set it to your API key before you run a review",
    );

    expect(result.out).toContain("Next: kerpeten review --dry-run");
    expect(existsSync(join(dir, ".kerpeten.yml"))).toBe(true);
  });

  test("a ChatGPT model checks the sign-in, next to the key of the other model", async () => {
    const signedIn = await init(
      setup(repo(), answers("1", "1", "n", "2", "claude-test-1", "en"), { home: await signedInHome() }),
    );

    expect(signedIn.code).toBe(ExitCode.OK);

    expect(signedIn.lines.slice(-6, -3)).toEqual([
      "  ok: ripgrep (rg) is on PATH",
      "  ok: signed in to ChatGPT (reviewer)",
      "  missing: ANTHROPIC_API_KEY is not set (judge); set it to your API key before you run a review",
    ]);

    const signedOut = await init(setup(repo(), answers("2", "claude-test-1", "n", "1", "typed-model", "en")));

    expect(signedOut.code).toBe(ExitCode.OK);
    expect(signedOut.out).toContain("  missing: not signed in to ChatGPT (judge); run `kerpeten auth login`");
  });

  test("a sign-in file that cannot be used is reported as missing with its reason", async () => {
    const home = tempHome(dirs);

    mkdirSync(join(home, ".config", "kerpeten"), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, ".config", "kerpeten", "auth.json"), "{ not json", { mode: 0o600 });

    const result = await init(setup(repo(), answers("1", "typed-model", "y", "en"), { home }));

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("The models of your ChatGPT plan cannot be listed (");
    expect(result.out).toContain("  missing: the ChatGPT sign-in cannot be used (reviewer and judge): ");
    expect(result.out).toContain("run `kerpeten auth login` again");
  });
});

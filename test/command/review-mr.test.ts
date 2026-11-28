import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KerpetenApp } from "../../src/app/KerpetenApp.ts";
import { ExitCode } from "../../src/harness-kit/index.ts";
import { commit, sh, tempRepo, write } from "../capability/git/git-utils.ts";
import { fakeGh, ghCalls, ghPaths, pullJson, SHA_C } from "../capability/platform/platform-utils.ts";
import type { GhAnswer } from "../capability/platform/types/platform.ts";
import { mockClient, promptText } from "../harness-kit/harness-kit-utils.ts";

const KEY = "sk-test-secret-value-123";

const GH_TOKEN = "ghp_REVIEW_MR_TEST_TOKEN_5d1c";

const KIMI_URL = "https://api.kimi.com/coding/v1";

const ENV = { KERPETEN_TRUSTED_ENDPOINTS: `KIMI_API_KEY=${KIMI_URL}`, KIMI_API_KEY: KEY };

const CONFIG = `models:
  reviewer: { provider: anthropic, model: k3.1-pro, base_url: "${KIMI_URL}", api_key_env: KIMI_API_KEY, max_output_tokens: 3000 }
  judge: { provider: anthropic, model: k3.1-judge, base_url: "${KIMI_URL}", api_key_env: KIMI_API_KEY, max_output_tokens: 2000 }
`;

const PULL = ghPaths(12).pull;

const finding = {
  file: "src/a.ts",
  start_line: 2,
  end_line: 2,
  category: "bug",
  title: "Division by zero",
  body: "y can be 0",
  fix: "Throw when y is 0.",
  evidence: [{ location: "src/a.ts:2", note: "no guard" }],
};

const labels = {
  verdict: "verified",
  priority: "P1",
  nature: "edge_case",
  fix_effort: "easy",
  rationale: "y is never checked",
  evidence: [{ location: "src/a.ts:2" }],
};

const REVIEW = [{ text: "done" }, { text: JSON.stringify({ findings: [finding] }) }];

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "kerpeten-cli-mr-"));

  dirs.push(dir);

  return dir;
}

/**
 * A repository on the branch `feature`, one commit after `fork` on `main`; `main` then got one more commit, `base`,
 * as the branch a pull request goes into does.
 */
function repo(): { dir: string; fork: string; base: string; head: string } {
  const dir = tempRepo("kerpeten-cli-mr-repo-");

  dirs.push(dir);
  write(dir, { "src/a.ts": "export const a = 1;\n", ".kerpeten.yml": CONFIG });

  const fork = commit(dir, "base");

  write(dir, { "other.ts": "export const other = 1;\n" });

  const base = commit(dir, "main moves on");

  sh(dir, ["checkout", "-q", "-b", "feature", fork]);
  write(dir, { "src/a.ts": "export const a = 1;\nexport const div = (x: number, y: number) => x / y;\n" });

  const head = commit(dir, "add div\n\nThe commit message says why.");

  return { dir, fork, base, head };
}

/**
 * Runs the command in `cwd` with a fake gh first on the PATH of the program's environment, which gives `answers`, or
 * with a PATH that holds no gh at all when `answers` is `"no gh"`. `bin` is the folder of the fake gh, a new one when
 * none is given, where it keeps what it was called with.
 */
async function run(
  cwd: string,
  argv: string[],
  answers: Readonly<Record<string, GhAnswer>> | "no gh",
  options: {
    env?: Record<string, string>;
    script?: Parameters<typeof mockClient>[0];
    judgeScript?: Parameters<typeof mockClient>[0];
    before?: string;
    bin?: string;
  } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const bin = options.bin ?? tempDir();
  const reviewerMock = mockClient(options.script ?? REVIEW);
  const judgeMock = mockClient(options.judgeScript ?? []);
  let created = 0;

  if (answers !== "no gh") fakeGh(bin, answers, options.before);

  const code = await KerpetenApp.run(
    {
      io: { out: (line) => out.push(line), err: (line) => err.push(line) },
      env: { ...ENV, ...options.env, PATH: answers === "no gh" ? bin : `${bin}:${process.env.PATH ?? ""}` },
      cwd,
      now: () => 0,
      createClient: () => (created++ === 0 ? reviewerMock.client : judgeMock.client),
    },
    argv,
  );

  return {
    code,
    out: out.join("\n"),
    err: err.join("\n"),
    bin,
    reviewerCalls: reviewerMock.calls,
    judgeCalls: judgeMock.calls,
    calls: [...reviewerMock.calls, ...judgeMock.calls],
  };
}

describe("kerpeten review --dry-run --mr", () => {
  test("reviews the pull request gh gives: one read of it, its title and description for the reviewer, one line for it in the output", async () => {
    const { dir, fork, base, head } = repo();

    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {
      [PULL]: {
        stdout: pullJson({
          headSha: head,
          baseSha: base,
          title: "Add a division helper",
          body: "Needed for the cart.",
        }),
      },
    });

    expect(result.code).toBe(ExitCode.OK);

    expect(result.out.split("\n").slice(0, 2)).toEqual([
      "merge request: #12 Add a division helper (open), github github.com, project 4242, tenant default",
      `review: ${fork.slice(0, 12)}..${head.slice(0, 12)}, 1 changed files, prompt reviewer v4`,
    ]);

    expect(result.out).toContain("- src/a.ts:2-2 [bug] Division by zero");
    expect(ghCalls(result.bin)).toEqual([["api", "--method", "GET", "repos/{owner}/{repo}/pulls/12"]]);

    const prompt = promptText(result.reviewerCalls[0]);

    expect(prompt).toMatch(/BEGIN DATA title \S+ ===\\nAdd a division helper\\n=== END DATA title/);
    expect(prompt).toMatch(/BEGIN DATA description \S+ ===\\nNeeded for the cart\.\\n=== END DATA description/);
    expect(prompt).not.toContain("The commit message says why.");

    expect(result.err).toContain(
      `"merge request read" command=review tenant=default platform=github host=github.com project=4242 mr=12 state=open head=${head} base=${base}`,
    );
  });

  test("--json has the merge request with the tenant of KERPETEN_TENANT, and no merge request without --mr", async () => {
    const { dir, base, head } = repo();
    const answers = { [PULL]: { stdout: pullJson({ headSha: head, baseSha: base, state: "closed", merged: true }) } };

    const result = await run(dir, ["review", "--dry-run", "--mr", "12", "--json"], answers, {
      env: { KERPETEN_TENANT: "acme" },
    });

    expect(result.code).toBe(ExitCode.OK);

    const printed = JSON.parse(result.out);

    expect(Object.keys(printed)).toEqual(["merge_request", "findings", "usage"]);

    expect(printed.merge_request).toEqual({
      tenant: "acme",
      platform: { kind: "github", host: "github.com" },
      project: { id: "4242" },
      mr: 12,
      title: "Add div",
      state: "merged",
      head_sha: head,
      base_sha: base,
    });

    expect(printed.findings.length).toBe(1);

    const local = await run(dir, ["review", "--dry-run", "--base", "main", "--json"], answers, {
      env: { KERPETEN_TENANT: "acme" },
    });

    expect(local.code).toBe(ExitCode.OK);
    expect(Object.keys(JSON.parse(local.out))).toEqual(["findings", "usage"]);
    expect(ghCalls(local.bin)).toEqual([]);
  });

  test("an empty KERPETEN_TENANT is the default tenant", async () => {
    const { dir, base, head } = repo();

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12", "--json"],
      { [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) } },
      { env: { KERPETEN_TENANT: "" } },
    );

    expect(JSON.parse(result.out).merge_request.tenant).toBe("default");
  });

  test("a pull request without a description gives the reviewer the commit messages", async () => {
    for (const body of [null, "", " \n\t\n"]) {
      const { dir, base, head } = repo();

      const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {
        [PULL]: { stdout: pullJson({ headSha: head, baseSha: base, body }) },
      });

      expect(result.code).toBe(ExitCode.OK);

      expect(promptText(result.reviewerCalls[0])).toMatch(
        /BEGIN DATA description \S+ ===\\nadd div\\n\\nThe commit message says why\.\\n=== END DATA description/,
      );
    }
  });

  test("a pull request whose change is empty prints the merge request and calls no model", async () => {
    const { dir, base } = repo();

    sh(dir, ["checkout", "-q", "main"]);

    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {
      [PULL]: { stdout: pullJson({ headSha: base, baseSha: base }) },
    });

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("merge request: #12 Add div (open), github github.com, project 4242, tenant default");
    expect(result.out).toContain("findings: 0");
    expect(result.calls.length).toBe(0);
  });

  test("control characters of the title never reach the terminal", async () => {
    const { dir, base, head } = repo();

    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {
      [PULL]: { stdout: pullJson({ headSha: head, baseSha: base, title: "Add \u001b[31mdiv\u0007\nreview: forged" }) },
    });

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).not.toContain("\u001b");
    expect(result.out).not.toContain("\u0007");
    expect(result.out.split("\n")[0]).toStartWith("merge request: #12 Add �[31mdiv� review: forged (open)");
  });

  test("a working copy at another commit stops the review after gh read the pull request, with no model call", async () => {
    const { dir, fork, base, head } = repo();
    const answers = { [PULL]: { stdout: pullJson({ headSha: fork, baseSha: base }) } };
    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], answers);

    expect(result.code).toBe(ExitCode.USAGE);

    expect(result.err).toContain(
      `kerpeten review: HEAD is at ${head} but pull request 12 is at ${fork}; the review is of the pull request's last commit, so run \`gh pr checkout 12\`, or push your commits, and run again`,
    );

    expect(result.out).toBe("");
    expect(ghCalls(result.bin).length).toBe(1);
    expect(result.reviewerCalls.length).toBe(0);
    expect(result.judgeCalls.length).toBe(0);

    writeFileSync(join(dir, "src/a.ts"), "export const changed = 1;\n");

    const dirty = await run(dir, ["review", "--dry-run", "--mr", "12"], answers);

    expect(dirty.code).toBe(ExitCode.USAGE);
    expect(dirty.err).toContain("HEAD is at");
    expect(dirty.err).not.toContain("uncommitted changes");
    expect(dirty.calls.length).toBe(0);
  });

  test("uncommitted changes stop the review at the pull request's commit before any model call", async () => {
    const { dir, base, head } = repo();

    writeFileSync(join(dir, "src/a.ts"), "export const changed = 1;\n");

    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {
      [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) },
    });

    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.err).toContain("1 tracked file has uncommitted changes: src/a.ts");
    expect(result.calls.length).toBe(0);
  });

  test("a base commit that is not in the repository stops the review and says to fetch", async () => {
    const { dir, head } = repo();

    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {
      [PULL]: { stdout: pullJson({ headSha: head, baseSha: SHA_C }) },
    });

    expect(result.code).toBe(ExitCode.USAGE);

    expect(result.err).toContain(
      `kerpeten review: the base commit ${SHA_C} of pull request 12 is not in this repository; fetch the branch the pull request goes into, for example with \`git fetch origin\`, and run again`,
    );

    expect(result.calls.length).toBe(0);
  });

  test("a gh that is not installed is a usage error that says to install it, before any model call", async () => {
    const { dir } = repo();
    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], "no gh");

    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.err).toContain("kerpeten review: --mr 12: gh, the GitHub CLI, is not found (");
    expect(result.err).toContain("): install it from https://cli.github.com and run again");
    expect(result.out).toBe("");
    expect(result.calls.length).toBe(0);
  });

  test("each failure of gh is a usage error with the flag and what to do, before any model call", async () => {
    const cases: [GhAnswer, string][] = [
      [
        { exitCode: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login\n" },
        "kerpeten review: --mr 12: gh is not signed in to GitHub: run `gh auth login` and run again",
      ],
      [
        { exitCode: 1, stderr: "gh: Not Found (HTTP 404)\n", stdout: '{"message":"Not Found","status":"404"}' },
        "kerpeten review: --mr 12: pull request 12 was not found in the GitHub repository of this folder: check the number, and that the sign-in of gh can read the repository",
      ],
      [
        { exitCode: 1, stderr: "unable to expand placeholder in path: no git remotes found\n" },
        "kerpeten review: --mr 12: gh finds no GitHub repository in this folder: run inside a clone whose remote is on GitHub",
      ],
      [
        { exitCode: 1, stderr: "gh: Server Error (HTTP 502)\n" },
        "kerpeten review: --mr 12: gh api failed (exit 1): gh: Server Error (HTTP 502)",
      ],
      [
        { stdout: "<html>busy</html>" },
        "kerpeten review: --mr 12: the answer of gh for pull request 12 cannot be read: it is no JSON",
      ],
    ];

    for (const [answer, message] of cases) {
      const { dir } = repo();
      const result = await run(dir, ["review", "--dry-run", "--mr", "12"], { [PULL]: answer });

      expect({ code: result.code, err: result.err }).toEqual({
        code: ExitCode.USAGE,
        err: expect.stringContaining(message),
      });

      expect(result.out).toBe("");
      expect(result.calls.length).toBe(0);
    }
  });

  test("refuses --mr together with --base before gh is called", async () => {
    const { dir, base, head } = repo();

    const result = await run(dir, ["review", "--dry-run", "--mr", "12", "--base", "main"], {
      [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) },
    });

    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.err).toContain("--mr and --base do not go together: the pull request names its own base");
    expect(ghCalls(result.bin)).toEqual([]);
    expect(result.calls.length).toBe(0);
  });

  for (const value of ["0", "abc", "1.5", "12x", "007", " 12", "", "99999999999999999999"]) {
    test(`refuses --mr ${JSON.stringify(value)} before gh is called`, async () => {
      const { dir, base, head } = repo();

      const result = await run(dir, ["review", "--dry-run", `--mr=${value}`], {
        [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) },
      });

      expect(result.code).toBe(ExitCode.USAGE);
      expect(result.err).toContain("--mr must be the number of a pull request, 1 or more");
      expect(ghCalls(result.bin)).toEqual([]);
      expect(result.calls.length).toBe(0);
    });
  }

  test("a GH_TOKEN of the environment reaches gh, and neither the models, the logs, the output nor ripgrep", async () => {
    const { dir, base, head } = repo();
    const dumps = tempDir();
    const before = process.env.GH_TOKEN;

    process.env.GH_TOKEN = GH_TOKEN;

    try {
      const bin = tempDir();

      writeFileSync(join(bin, "rg"), `#!/bin/sh\nenv > '${join(dumps, "rg-env.txt")}'\nexit 1\n`);
      chmodSync(join(bin, "rg"), 0o755);

      const result = await run(
        dir,
        ["review", "--dry-run", "--mr", "12", "--json"],
        { [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) } },
        {
          env: { GH_TOKEN },
          bin,
          before: `env > '${join(dumps, "gh-env.txt")}'`,
          script: [{ toolCalls: [{ name: "grep", input: { pattern: "div" } }] }, ...REVIEW] as never,
          judgeScript: [{ text: "done" }, { text: JSON.stringify(labels) }],
        },
      );

      expect(result.code).toBe(ExitCode.OK);
      expect(result.reviewerCalls.length).toBe(3);
      expect(result.judgeCalls.length).toBe(2);

      for (const call of result.calls) expect(promptText(call)).not.toContain(GH_TOKEN);

      expect(result.out).not.toContain(GH_TOKEN);
      expect(result.err).not.toContain(GH_TOKEN);
      expect(result.err).toContain('"tool call" command=review harness=reviewer tool=grep');
      expect(readFileSync(join(dumps, "gh-env.txt"), "utf8")).toContain(`GH_TOKEN=${GH_TOKEN}`);

      const ripgrepEnv = readFileSync(join(dumps, "rg-env.txt"), "utf8");

      expect(ripgrepEnv).toContain("PATH=");
      expect(ripgrepEnv).not.toContain("GH_TOKEN");
      expect(ripgrepEnv).not.toContain(GH_TOKEN);
      expect(ripgrepEnv).not.toContain(KEY);
    } finally {
      if (before === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = before;
    }
  });
});

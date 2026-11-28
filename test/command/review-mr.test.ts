import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KerpetenApp } from "../../src/app/KerpetenApp.ts";
import { ExitCode } from "../../src/harness-kit/index.ts";
import { commit, sh, tempRepo, write } from "../capability/git/git-utils.ts";
import {
  fakeCli,
  GITHUB_ORIGIN,
  GITLAB_ORIGIN,
  ghCalls,
  ghPaths,
  glabCalls,
  glabPaths,
  mergeRequestJson,
  pullJson,
  SHA_C,
} from "../capability/platform/platform-utils.ts";
import type { CliAnswer, CliName, GhAnswer } from "../capability/platform/types/platform.ts";
import { mockClient, promptText } from "../harness-kit/harness-kit-utils.ts";

const KEY = "sk-test-secret-value-123";

const GH_TOKEN = "ghp_REVIEW_MR_TEST_TOKEN_5d1c";

const GITLAB_TOKEN = "gitlab-token-of-the-review-mr-test-77e2";

const SELF_HOSTED_ORIGIN = "https://git.example.com/acme/shop.git";

const KIMI_URL = "https://api.kimi.com/coding/v1";

const ENV = { KERPETEN_TRUSTED_ENDPOINTS: `KIMI_API_KEY=${KIMI_URL}`, KIMI_API_KEY: KEY };

const CONFIG = `models:
  reviewer: { provider: anthropic, model: k3.1-pro, base_url: "${KIMI_URL}", api_key_env: KIMI_API_KEY, max_output_tokens: 3000 }
  judge: { provider: anthropic, model: k3.1-judge, base_url: "${KIMI_URL}", api_key_env: KIMI_API_KEY, max_output_tokens: 2000 }
`;

const PULL = ghPaths(12).pull;

const LOWER_CASE_PULL = ghPaths(12, "acme/shop").pull;

const MERGE_REQUEST = glabPaths(12).mergeRequest;

const GH_READ = ["api", "--method", "GET", "--hostname", "github.com", PULL];

const GLAB_READ = ["api", "--method", "GET", "--output", "ndjson", "--hostname", "gitlab.com", MERGE_REQUEST];

const NEEDS_PROJECT =
  "a review of a pull request or merge request reads it from the project of the origin remote, so the remote must be the address of a project on GitHub or GitLab";

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
 * as the branch a pull request goes into does. Its remote `origin` is at `origin`, on github.com when none is given
 * and missing for `"no origin"`. `config` is added to its `.kerpeten.yml`.
 */
function repo(origin: string = GITHUB_ORIGIN, config = ""): { dir: string; fork: string; base: string; head: string } {
  const dir = tempRepo("kerpeten-cli-mr-repo-");

  dirs.push(dir);

  if (origin !== "no origin") sh(dir, ["remote", "add", "origin", origin]);

  write(dir, { "src/a.ts": "export const a = 1;\n", ".kerpeten.yml": `${CONFIG}${config}` });

  const fork = commit(dir, "base");

  write(dir, { "other.ts": "export const other = 1;\n" });

  const base = commit(dir, "main moves on");

  sh(dir, ["checkout", "-q", "-b", "feature", fork]);
  write(dir, { "src/a.ts": "export const a = 1;\nexport const div = (x: number, y: number) => x / y;\n" });

  const head = commit(dir, "add div\n\nThe commit message says why.");

  return { dir, fork, base, head };
}

/**
 * Runs the command in `cwd` with a fake `cli`, gh when none is named, first on the PATH of the program's environment,
 * which gives `answers`, or with a PATH that does not hold that tool at all when `answers` is `"not installed"`. The
 * tool of the other platform is there too, as a fake without answers, so a call of it shows. `bin` is the folder of
 * the fakes, a new one when none is given, where they keep what they were called with.
 */
async function run(
  cwd: string,
  argv: string[],
  answers: Readonly<Record<string, CliAnswer>> | "not installed",
  options: {
    cli?: CliName;
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
  const cli = options.cli ?? "gh";
  let created = 0;

  fakeCli(bin, cli === "gh" ? "glab" : "gh", {});

  if (answers !== "not installed") fakeCli(bin, cli, answers, options.before);

  const code = await KerpetenApp.run(
    {
      io: { out: (line) => out.push(line), err: (line) => err.push(line) },
      env: { ...ENV, ...options.env, PATH: answers === "not installed" ? bin : `${bin}:${process.env.PATH ?? ""}` },
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
    expect(ghCalls(result.bin)).toEqual([GH_READ]);
    expect(glabCalls(result.bin)).toEqual([]);

    const prompt = promptText(result.reviewerCalls[0]);

    expect(prompt).toMatch(/BEGIN DATA title \S+ ===\\nAdd a division helper\\n=== END DATA title/);
    expect(prompt).toMatch(/BEGIN DATA description \S+ ===\\nNeeded for the cart\.\\n=== END DATA description/);
    expect(prompt).not.toContain("The commit message says why.");

    expect(result.err).toContain('"review started" command=review mode=merge-request provider=anthropic');
    expect(result.err).not.toContain("mode=local-branch");

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
    expect(local.err).toContain('"review started" command=review mode=local-branch provider=anthropic');
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
      `kerpeten review: the base commit ${SHA_C} of pull request 12 is not in this repository; fetch the branch the pull request goes into with \`git fetch origin\`, and run again`,
    );

    expect(result.calls.length).toBe(0);
  });

  test("a gh that is not installed is a usage error that says to install it, before any model call", async () => {
    const { dir } = repo();
    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], "not installed");

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
        "kerpeten review: --mr 12: gh is not signed in to github.com: run `gh auth login --hostname github.com` and run again",
      ],
      [
        { exitCode: 1, stderr: "gh: Not Found (HTTP 404)\n", stdout: '{"message":"Not Found","status":"404"}' },
        "kerpeten review: --mr 12: pull request 12 was not found in github.com/Acme/Shop, the repository of the origin remote: check the number, and that gh is signed in to github.com with an account that can read the repository; a pull request of another repository, such as the one a fork was made from, is not read",
      ],
      [
        { stdout: pullJson({ fullName: "Other/Shop" }) },
        'kerpeten review: --mr 12: gh answered with a pull request of "Other/Shop", not of Acme/Shop, the repository of the origin remote; when the repository was renamed or moved, point the origin remote at its new address and run again',
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

    expect(result.err).toContain(
      "--mr and --base do not go together: the pull request or merge request names its own base",
    );

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
      expect(result.err).toContain("--mr must be the number of a pull request or merge request, 1 or more");
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

describe("kerpeten review --dry-run --mr on a GitLab repository", () => {
  test("reviews the merge request glab gives: one read of it, its title and description for the reviewer, one line for it in the output", async () => {
    const { dir, fork, base, head } = repo(GITLAB_ORIGIN);

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      {
        [MERGE_REQUEST]: {
          stdout: mergeRequestJson({
            sha: head,
            baseSha: base,
            title: "Add a division helper",
            description: "Needed for the cart.",
          }),
        },
      },
      { cli: "glab" },
    );

    expect(result.code).toBe(ExitCode.OK);

    expect(result.out.split("\n").slice(0, 2)).toEqual([
      "merge request: #12 Add a division helper (open), gitlab gitlab.com, project 4242, tenant default",
      `review: ${fork.slice(0, 12)}..${head.slice(0, 12)}, 1 changed files, prompt reviewer v4`,
    ]);

    expect(result.out).toContain("- src/a.ts:2-2 [bug] Division by zero");
    expect(glabCalls(result.bin)).toEqual([GLAB_READ]);
    expect(ghCalls(result.bin)).toEqual([]);

    const prompt = promptText(result.reviewerCalls[0]);

    expect(prompt).toMatch(/BEGIN DATA title \S+ ===\\nAdd a division helper\\n=== END DATA title/);
    expect(prompt).toMatch(/BEGIN DATA description \S+ ===\\nNeeded for the cart\.\\n=== END DATA description/);
    expect(prompt).not.toContain("The commit message says why.");

    expect(result.err).toContain(
      `"merge request read" command=review tenant=default platform=gitlab host=gitlab.com project=4242 mr=12 state=open head=${head} base=${base}`,
    );
  });

  test("--json has the merge request with the platform gitlab", async () => {
    const { dir, base, head } = repo(GITLAB_ORIGIN);

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12", "--json"],
      { [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: head, baseSha: base, state: "merged" }) } },
      { cli: "glab", env: { KERPETEN_TENANT: "acme" } },
    );

    expect(result.code).toBe(ExitCode.OK);

    const printed = JSON.parse(result.out);

    expect(Object.keys(printed)).toEqual(["merge_request", "findings", "usage"]);

    expect(printed.merge_request).toEqual({
      tenant: "acme",
      platform: { kind: "gitlab", host: "gitlab.com" },
      project: { id: "4242" },
      mr: 12,
      title: "Add div",
      state: "merged",
      head_sha: head,
      base_sha: base,
    });

    expect(printed.findings.length).toBe(1);
  });

  test("a merge request whose base is where the branch left the target branch is reviewed from there", async () => {
    const { dir, fork, head } = repo(GITLAB_ORIGIN);

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      { [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: head, baseSha: fork, description: null }) } },
      { cli: "glab" },
    );

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain(`review: ${fork.slice(0, 12)}..${head.slice(0, 12)}, 1 changed files`);

    expect(promptText(result.reviewerCalls[0])).toMatch(
      /BEGIN DATA description \S+ ===\\nadd div\\n\\nThe commit message says why\.\\n=== END DATA description/,
    );
  });

  test("a working copy at another commit stops the review after glab read the merge request, with no model call, and says glab mr checkout", async () => {
    const { dir, fork, base, head } = repo(GITLAB_ORIGIN);

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      { [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: fork, baseSha: base }) } },
      { cli: "glab" },
    );

    expect(result.code).toBe(ExitCode.USAGE);

    expect(result.err).toContain(
      `kerpeten review: HEAD is at ${head} but merge request 12 is at ${fork}; the review is of the merge request's last commit, so run \`glab mr checkout 12\`, or push your commits, and run again`,
    );

    expect(result.err).not.toContain("pull request");
    expect(result.err).not.toContain("gh pr");
    expect(result.out).toBe("");
    expect(glabCalls(result.bin).length).toBe(1);
    expect(ghCalls(result.bin)).toEqual([]);
    expect(result.reviewerCalls.length).toBe(0);
    expect(result.judgeCalls.length).toBe(0);
  });

  test("a base commit that is not in the repository stops the review in GitLab's words", async () => {
    const { dir, head } = repo(GITLAB_ORIGIN);

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      { [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: head, baseSha: SHA_C }) } },
      { cli: "glab" },
    );

    expect(result.code).toBe(ExitCode.USAGE);

    expect(result.err).toContain(
      `kerpeten review: the base commit ${SHA_C} of merge request 12 is not in this repository; fetch the branch the merge request goes into with \`git fetch origin\`, and run again`,
    );

    expect(result.calls.length).toBe(0);
  });

  test("a glab that is not installed is a usage error that says to install it, before any model call, and gh is not tried", async () => {
    const { dir } = repo(GITLAB_ORIGIN);
    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], "not installed", { cli: "glab" });

    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.err).toContain("kerpeten review: --mr 12: glab, the GitLab CLI, is not found (");
    expect(result.err).toContain("): install it from https://gitlab.com/gitlab-org/cli and run again");
    expect(result.out).toBe("");
    expect(ghCalls(result.bin)).toEqual([]);
    expect(result.calls.length).toBe(0);
  });

  test("each failure of glab is a usage error with the flag and what to do, before any model call", async () => {
    const cases: [CliAnswer, string][] = [
      [
        { exitCode: 1, stderr: "glab: 401 Unauthorized (HTTP 401)\n", stdout: '{"message":"401 Unauthorized"}' },
        "kerpeten review: --mr 12: GitLab at gitlab.com did not accept the sign-in of glab (HTTP 401): run `glab auth login --hostname gitlab.com`, or correct the token in GITLAB_TOKEN when that variable is set, and run again",
      ],
      [
        { exitCode: 1, stderr: "glab: 404 Not found (HTTP 404)\n", stdout: '{"message":"404 Not found"}' },
        "kerpeten review: --mr 12: merge request 12 was not found in gitlab.com/acme/shop, the project of the origin remote: check the number; GitLab gives the same answer for a private project that glab cannot read, so check too that glab is signed in to gitlab.com (`glab auth login --hostname gitlab.com`) with an account that can read the project; a merge request of another project, such as the one a fork was made from, is not read",
      ],
      [
        { stdout: mergeRequestJson({ webUrl: "https://gitlab.com/other/shop/-/merge_requests/12" }) },
        'kerpeten review: --mr 12: glab answered with a merge request of "other/shop", not of acme/shop, the project of the origin remote; when the project was renamed or moved, point the origin remote at its new address and run again',
      ],
      [
        { exitCode: 1, stderr: "glab: 502 Bad Gateway (HTTP 502)\n" },
        "kerpeten review: --mr 12: glab api failed (exit 1): glab: 502 Bad Gateway (HTTP 502)",
      ],
      [
        { stdout: "<html>busy</html>" },
        "kerpeten review: --mr 12: the answer of glab for merge request 12 cannot be read: it is no JSON",
      ],
      [
        { stdout: mergeRequestJson({ state: "locked" }) },
        "kerpeten review: --mr 12: merge request 12 is locked: GitLab is merging it right now, so run again when the merge is done",
      ],
      [
        { stdout: mergeRequestJson({ baseSha: null }) },
        "kerpeten review: --mr 12: merge request 12 has no diff yet, GitLab names no commits for it: push a commit to its branch, or wait until GitLab has made the diff, and run again",
      ],
    ];

    for (const [answer, message] of cases) {
      const { dir } = repo(GITLAB_ORIGIN);

      const result = await run(
        dir,
        ["review", "--dry-run", "--mr", "12"],
        { [MERGE_REQUEST]: answer },
        { cli: "glab" },
      );

      expect({ code: result.code, err: result.err }).toEqual({
        code: ExitCode.USAGE,
        err: expect.stringContaining(message),
      });

      expect(result.out).toBe("");
      expect(ghCalls(result.bin)).toEqual([]);
      expect(result.calls.length).toBe(0);
    }
  });

  test("a GITLAB_TOKEN of the environment reaches glab, and neither the models, the logs, the output nor ripgrep", async () => {
    const { dir, base, head } = repo(GITLAB_ORIGIN);
    const dumps = tempDir();
    const before = process.env.GITLAB_TOKEN;

    process.env.GITLAB_TOKEN = GITLAB_TOKEN;

    try {
      const bin = tempDir();

      writeFileSync(join(bin, "rg"), `#!/bin/sh\nenv > '${join(dumps, "rg-env.txt")}'\nexit 1\n`);
      chmodSync(join(bin, "rg"), 0o755);

      const result = await run(
        dir,
        ["review", "--dry-run", "--mr", "12", "--json"],
        { [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: head, baseSha: base }) } },
        {
          cli: "glab",
          env: { GITLAB_TOKEN },
          bin,
          before: `env > '${join(dumps, "glab-env.txt")}'`,
          script: [{ toolCalls: [{ name: "grep", input: { pattern: "div" } }] }, ...REVIEW] as never,
          judgeScript: [{ text: "done" }, { text: JSON.stringify(labels) }],
        },
      );

      expect(result.code).toBe(ExitCode.OK);
      expect(result.reviewerCalls.length).toBe(3);
      expect(result.judgeCalls.length).toBe(2);

      for (const call of result.calls) expect(promptText(call)).not.toContain(GITLAB_TOKEN);

      expect(result.out).not.toContain(GITLAB_TOKEN);
      expect(result.err).not.toContain(GITLAB_TOKEN);
      expect(result.err).toContain('"tool call" command=review harness=reviewer tool=grep');
      expect(readFileSync(join(dumps, "glab-env.txt"), "utf8")).toContain(`GITLAB_TOKEN=${GITLAB_TOKEN}`);

      const ripgrepEnv = readFileSync(join(dumps, "rg-env.txt"), "utf8");

      expect(ripgrepEnv).toContain("PATH=");
      expect(ripgrepEnv).not.toContain("GITLAB_TOKEN");
      expect(ripgrepEnv).not.toContain(GITLAB_TOKEN);
      expect(ripgrepEnv).not.toContain(KEY);
    } finally {
      if (before === undefined) delete process.env.GITLAB_TOKEN;
      else process.env.GITLAB_TOKEN = before;
    }
  });
});

describe("kerpeten review --dry-run --mr: the platform of the repository", () => {
  test("the platform key of .kerpeten.yml names the platform of a repository on a host of its own", async () => {
    const gitlab = repo(SELF_HOSTED_ORIGIN, "platform: gitlab\n");

    const onGitLab = await run(
      gitlab.dir,
      ["review", "--dry-run", "--mr", "12", "--json"],
      {
        [MERGE_REQUEST]: {
          stdout: mergeRequestJson({
            sha: gitlab.head,
            baseSha: gitlab.base,
            webUrl: "https://git.example.com/acme/shop/-/merge_requests/12",
          }),
        },
      },
      { cli: "glab" },
    );

    expect(onGitLab.code).toBe(ExitCode.OK);
    expect(JSON.parse(onGitLab.out).merge_request.platform).toEqual({ kind: "gitlab", host: "git.example.com" });
    expect(ghCalls(onGitLab.bin)).toEqual([]);

    expect(glabCalls(onGitLab.bin)).toEqual([
      ["api", "--method", "GET", "--output", "ndjson", "--hostname", "git.example.com", MERGE_REQUEST],
    ]);

    const github = repo(SELF_HOSTED_ORIGIN, "platform: github\n");

    const onGitHub = await run(github.dir, ["review", "--dry-run", "--mr", "12", "--json"], {
      [LOWER_CASE_PULL]: {
        stdout: pullJson({
          headSha: github.head,
          baseSha: github.base,
          htmlUrl: "https://git.example.com/Acme/Shop/pull/12",
        }),
      },
    });

    expect(onGitHub.code).toBe(ExitCode.OK);
    expect(JSON.parse(onGitHub.out).merge_request.platform).toEqual({ kind: "github", host: "git.example.com" });
    expect(glabCalls(onGitHub.bin)).toEqual([]);

    expect(ghCalls(onGitHub.bin)).toEqual([
      ["api", "--method", "GET", "--hostname", "git.example.com", LOWER_CASE_PULL],
    ]);
  });

  test("the platform key wins over the host of the origin remote", async () => {
    const { dir, base, head } = repo(GITLAB_ORIGIN, "platform: github\n");

    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {
      [LOWER_CASE_PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) },
    });

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("merge request: #12 Add div (open), github github.com, project 4242, tenant default");
    expect(ghCalls(result.bin)).toEqual([["api", "--method", "GET", "--hostname", "gitlab.com", LOWER_CASE_PULL]]);
    expect(glabCalls(result.bin)).toEqual([]);
  });

  test("the project of a review is the one of the origin remote, also in a clone with a remote named upstream", async () => {
    const github = repo();

    sh(github.dir, ["remote", "add", "upstream", "https://github.com/Other/Shop.git"]);

    const onGitHub = await run(github.dir, ["review", "--dry-run", "--mr", "12", "--json"], {
      [PULL]: { stdout: pullJson({ headSha: github.head, baseSha: github.base }) },
      [ghPaths(12, "Other/Shop").pull]: {
        stdout: pullJson({
          headSha: github.head,
          baseSha: github.base,
          title: "Of the other project",
          fullName: "Other/Shop",
        }),
      },
    });

    expect(onGitHub.code).toBe(ExitCode.OK);
    expect(JSON.parse(onGitHub.out).merge_request.title).toBe("Add div");
    expect(ghCalls(onGitHub.bin)).toEqual([GH_READ]);

    const gitlab = repo(GITLAB_ORIGIN);

    sh(gitlab.dir, ["remote", "add", "upstream", "git@gitlab.com:other/shop.git"]);
    sh(gitlab.dir, ["config", "remote.upstream.glab-resolved", "base"]);

    const onGitLab = await run(
      gitlab.dir,
      ["review", "--dry-run", "--mr", "12", "--json"],
      {
        [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: gitlab.head, baseSha: gitlab.base }) },
        [glabPaths(12, "other/shop").mergeRequest]: {
          stdout: mergeRequestJson({
            sha: gitlab.head,
            baseSha: gitlab.base,
            title: "Of the other project",
            webUrl: "https://gitlab.com/other/shop/-/merge_requests/12",
          }),
        },
      },
      { cli: "glab" },
    );

    expect(onGitLab.code).toBe(ExitCode.OK);
    expect(JSON.parse(onGitLab.out).merge_request.title).toBe("Add div");
    expect(glabCalls(onGitLab.bin)).toEqual([GLAB_READ]);
  });

  test("an origin remote in git's remote helper form is read as the URL it holds", async () => {
    const { dir, base, head } = repo("https::https://gitlab.com/acme/shop.git");

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      { [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: head, baseSha: base }) } },
      { cli: "glab" },
    );

    expect(result.code).toBe(ExitCode.OK);
    expect(glabCalls(result.bin)).toEqual([GLAB_READ]);
    expect(ghCalls(result.bin)).toEqual([]);
  });

  test("an origin remote that names no project is a usage error before any tool or model is called, with or without the platform key", async () => {
    const noOrigin =
      "kerpeten review: --mr 12: this repository has no origin remote: a review of a pull request or merge request reads it from the project of the origin remote, so add one with `git remote add origin <address of the project>`";

    const cases: [string, string, string][] = [
      ["no origin", "", noOrigin],
      ["no origin", "platform: gitlab\n", noOrigin],
      ["no origin", "platform: github\n", noOrigin],
      [
        "/srv/git/shop.git",
        "platform: gitlab\n",
        `kerpeten review: --mr 12: the origin remote is a path on this machine: ${NEEDS_PROJECT}`,
      ],
      [
        "ext::ssh -q git@gitlab.com %S acme/shop",
        "",
        `kerpeten review: --mr 12: the origin remote uses git's remote helper ext, whose address is no URL with a host: ${NEEDS_PROJECT}`,
      ],
      [
        "https://reader:hunter2@github.com/Acme/Shop?page=hunter2",
        "",
        `kerpeten review: --mr 12: the URL of the origin remote has a query or a fragment, which the address of a project does not have: ${NEEDS_PROJECT}`,
      ],
      [
        "git@github.com:Acme/Shop/pulls",
        "",
        "kerpeten review: --mr 12: the origin remote names github.com/Acme/Shop/pulls, which is no GitHub repository: a repository is an owner and a name, <owner>/<name>",
      ],
      [
        "git@gitlab.com:shop.git",
        "",
        "kerpeten review: --mr 12: the origin remote names gitlab.com/shop, which is no GitLab project: a project is a namespace and a name, <namespace>/<name>",
      ],
    ];

    for (const [origin, config, message] of cases) {
      const { dir } = repo(origin, config);
      const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {});

      expect({ code: result.code, err: result.err }).toEqual({
        code: ExitCode.USAGE,
        err: expect.stringContaining(message),
      });

      expect(result.err).not.toContain("hunter2");
      expect(result.out).toBe("");
      expect(ghCalls(result.bin)).toEqual([]);
      expect(glabCalls(result.bin)).toEqual([]);
      expect(result.calls.length).toBe(0);
    }
  });

  test("a host that is neither github.com nor gitlab.com is a usage error that says to set platform, before any tool or model is called", async () => {
    const cases: [string, string][] = [
      [
        SELF_HOSTED_ORIGIN,
        "kerpeten review: --mr 12: the origin remote is on git.example.com, which is neither github.com nor gitlab.com: set `platform: github` or `platform: gitlab` in .kerpeten.yml",
      ],
      [
        "https://reader:hunter2@gitlab.example.com/acme/shop.git",
        "kerpeten review: --mr 12: the origin remote is on gitlab.example.com, which is neither github.com nor gitlab.com: set `platform: github` or `platform: gitlab` in .kerpeten.yml",
      ],
    ];

    for (const [origin, message] of cases) {
      const { dir, base, head } = repo(origin);

      const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {
        [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) },
      });

      expect({ code: result.code, err: result.err }).toEqual({
        code: ExitCode.USAGE,
        err: expect.stringContaining(message),
      });

      expect(result.err).not.toContain("hunter2");
      expect(result.out).toBe("");
      expect(ghCalls(result.bin)).toEqual([]);
      expect(glabCalls(result.bin)).toEqual([]);
      expect(result.calls.length).toBe(0);
    }
  });

  test("a review without --mr chooses no platform: it runs on a host of its own without the platform key", async () => {
    const { dir } = repo(SELF_HOSTED_ORIGIN);
    const result = await run(dir, ["review", "--dry-run", "--base", "main", "--json"], {});

    expect(result.code).toBe(ExitCode.OK);
    expect(Object.keys(JSON.parse(result.out))).toEqual(["findings", "usage"]);
    expect(ghCalls(result.bin)).toEqual([]);
    expect(glabCalls(result.bin)).toEqual([]);
  });

  test("a platform the configuration does not know is refused with the configuration, before any tool or model is called", async () => {
    const { dir } = repo(GITLAB_ORIGIN, "platform: bitbucket\n");
    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {}, { cli: "glab" });

    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.err).toContain("/platform");
    expect(glabCalls(result.bin)).toEqual([]);
    expect(result.calls.length).toBe(0);
  });
});

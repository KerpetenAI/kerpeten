import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KerpetenApp } from "../../src/app/KerpetenApp.ts";
import { ExitCode } from "../../src/harness-kit/index.ts";
import { CommentMarker } from "../../src/layer/comment/CommentMarker.ts";
import { commit, sh, tempRepo, write } from "../capability/git/git-utils.ts";
import {
  discussion,
  fakeCli,
  GITHUB_ORIGIN,
  GITLAB_ORIGIN,
  ghCalls,
  ghPaths,
  glabCalls,
  glabPaths,
  jsonLines,
  mergeRequestJson,
  noComments,
  noDiscussions,
  note,
  position,
  pullJson,
  SHA_B,
  SHA_C,
  slurped,
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

const COMMENTS = ghPaths(12);

const PULL = COMMENTS.pull;

const LOWER_CASE_PULL = ghPaths(12, "acme/shop").pull;

const MERGE_REQUEST = glabPaths(12).mergeRequest;

const DISCUSSIONS = glabPaths(12).discussions;

const GH_READ = ["api", "--method", "GET", "--hostname", "github.com"];

const GLAB_READ = ["api", "--method", "GET", "--output", "ndjson", "--hostname", "gitlab.com", MERGE_REQUEST];

const NEEDS_PROJECT =
  "a review of a pull request or merge request reads it from the project of the origin remote, so the remote must be the address of a project on GitHub or GitLab";

const GLAB_DISCUSSIONS = [
  "api",
  "--method",
  "GET",
  "--output",
  "ndjson",
  "--hostname",
  "gitlab.com",
  "--paginate",
  DISCUSSIONS,
];

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

const JUDGED = [{ text: "done" }, { text: JSON.stringify(labels) }];

const JUDGED_HIGH = [{ text: "done" }, { text: JSON.stringify({ ...labels, priority: "P0", nature: "critical" }) }];

const NOTE = "👎 If you do not want this finding again, react with 👎; you can reply with the reason.";

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
 * which gives `answers`, or with a PATH that does not hold that tool at all when `answers` is `"not installed"`.
 * Merge request 12 has no comment unless `answers` give some. The tool of the other platform is there too, as a fake
 * without answers, so a call of it shows. `bin` is the folder of the fakes, a new one when none is given, where they
 * keep what they were called with.
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

  if (answers !== "not installed") {
    fakeCli(bin, cli, { ...(cli === "gh" ? noComments(12) : noDiscussions(12)), ...answers }, options.before);
  }

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

    expect(ghCalls(result.bin)).toEqual([
      [...GH_READ, PULL],
      [...GH_READ, "--paginate", "--slurp", COMMENTS.comments],
      [...GH_READ, "--paginate", "--slurp", COMMENTS.reviews],
      [...GH_READ, "--paginate", "--slurp", COMMENTS.conversation],
    ]);

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

    expect(Object.keys(printed)).toEqual(["merge_request", "findings", "comment_plan", "usage"]);

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

  test("each failure of gh ends the review before any model call, with the flag and what to do: with 2 when the user can put it right, with 1 when GitHub failed", async () => {
    const cases: [GhAnswer, string, ExitCode][] = [
      [
        { exitCode: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login\n" },
        "kerpeten review: --mr 12: gh is not signed in to github.com: run `gh auth login --hostname github.com` and run again",
        ExitCode.USAGE,
      ],
      [
        { exitCode: 1, stderr: "gh: Not Found (HTTP 404)\n", stdout: '{"message":"Not Found","status":"404"}' },
        "kerpeten review: --mr 12: pull request 12 was not found in github.com/Acme/Shop, the repository of the origin remote: check the number, and that gh is signed in to github.com with an account that can read the repository; a pull request of another repository, such as the one a fork was made from, is not read",
        ExitCode.USAGE,
      ],
      [
        { stdout: pullJson({ fullName: "Other/Shop" }) },
        'kerpeten review: --mr 12: gh answered with a pull request of "Other/Shop", not of Acme/Shop, the repository of the origin remote; when the repository was renamed or moved, point the origin remote at its new address and run again',
        ExitCode.FAILED,
      ],
      [
        { exitCode: 1, stderr: "gh: Server Error (HTTP 502)\n" },
        "kerpeten review: --mr 12: gh api failed (exit 1): gh: Server Error (HTTP 502)",
        ExitCode.FAILED,
      ],
      [
        { stdout: "<html>busy</html>" },
        "kerpeten review: --mr 12: the answer of gh for pull request 12 cannot be read: it is no JSON",
        ExitCode.FAILED,
      ],
    ];

    for (const [answer, message, code] of cases) {
      const { dir } = repo();
      const result = await run(dir, ["review", "--dry-run", "--mr", "12"], { [PULL]: answer });

      expect({ code: result.code, err: result.err }).toEqual({
        code,
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

/** A comment on lines of `src/a.ts` as GitHub gives it, written by `login` with the text `body`. */
function lineComment(id: number, login: string, body: string): Record<string, unknown> {
  return {
    id,
    user: { login },
    body,
    path: "src/a.ts",
    subject_type: "line",
    side: "RIGHT",
    start_side: null,
    line: 2,
    start_line: null,
    original_line: 2,
    original_start_line: null,
    commit_id: SHA_B,
    original_commit_id: SHA_B,
    created_at: "2026-11-20T10:00:00Z",
  };
}

describe("kerpeten review --dry-run --mr: the comment plan", () => {
  test("the text output has one line for the comment plan after the findings line, and the finding shows its planned action", async () => {
    const { dir, base, head } = repo();

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      { [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) } },
      { judgeScript: JUDGED_HIGH },
    );

    expect(result.code).toBe(ExitCode.OK);

    expect(result.out.split("\n").slice(2, 6)).toEqual([
      "findings: 1",
      "comment plan: 1 line comments, 0 in the summary, 0 already written, 0 stored",
      "- src/a.ts:2-2 [bug] Division by zero",
      "  verdict verified, priority P0, nature critical, fix_effort easy, score 95, action inline",
    ]);

    expect(result.out).not.toContain("kerpeten:finding");
    expect(result.err).toContain('"comment plan" command=review inline=1 summary=0 duplicate=0 stored=0');
  });

  test("--json has the comment plan with the whole text of the line comment and of the summary comment", async () => {
    const { dir, base, head } = repo();

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12", "--json"],
      { [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) } },
      { judgeScript: JUDGED_HIGH },
    );

    expect(result.code).toBe(ExitCode.OK);

    const printed = JSON.parse(result.out);

    expect(printed.findings.map((item: { action: string }) => item.action)).toEqual(["inline"]);

    expect(printed.comment_plan).toEqual({
      line_comments: [
        {
          file: "src/a.ts",
          start_line: 2,
          end_line: 2,
          body: [
            "**Division by zero** · bug · P0",
            "",
            "y can be 0",
            "",
            "**Fix:** Throw when y is 0.",
            "",
            NOTE,
            `<!-- kerpeten:finding v1 head=${head} file=c3JjL2EudHM lines=2-2 -->`,
          ].join("\n"),
        },
      ],
      summary: {
        body: [
          "## Kerpeten review",
          `Reviewed commit ${head}. Line comments in this run: 1.`,
          `<!-- kerpeten:summary v1 head=${head} -->`,
        ].join("\n\n"),
      },
    });
  });

  test("a finding scored for the summary is listed in the summary comment, and no line comment is planned", async () => {
    const { dir, base, head } = repo();

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12", "--json"],
      { [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) } },
      { judgeScript: JUDGED },
    );

    const printed = JSON.parse(result.out);

    expect(printed.findings.map((item: { action: string }) => item.action)).toEqual(["summary"]);
    expect(printed.comment_plan.line_comments).toEqual([]);

    expect(printed.comment_plan.summary.body).toBe(
      [
        "## Kerpeten review",
        `Reviewed commit ${head}. Line comments in this run: 0.`,
        "### Division by zero\n`src/a.ts:2` · bug · P1",
        "y can be 0",
        "**Fix:** Throw when y is 0.",
        `<!-- kerpeten:summary v1 head=${head} -->`,
      ].join("\n\n"),
    );
  });

  test("a line comment with Kerpeten's marker for the same commit and lines, whoever wrote it, makes the finding already written", async () => {
    const { dir, base, head } = repo();
    const marker = CommentMarker.finding(head, "src/a.ts", 2, 2).line();

    const answers = {
      [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) },
      [COMMENTS.comments]: {
        stdout: slurped([
          lineComment(101, "ada", "I do not agree with this."),
          lineComment(
            102,
            "the-user-themselves",
            `**Division by zero** · bug · P0\n\ny can be 0\n\n${NOTE}\n${marker}`,
          ),
        ]),
      },
    };

    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], answers, { judgeScript: JUDGED_HIGH });

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("comment plan: 0 line comments, 0 in the summary, 1 already written, 0 stored");
    expect(result.out).toContain("score 95, action suppressed_duplicate");
    expect(result.err).toContain('"merge request comments read" command=review kerpeten_line=1 kerpeten_summary=0');

    const json = await run(dir, ["review", "--dry-run", "--mr", "12", "--json"], answers, { judgeScript: JUDGED_HIGH });
    const printed = JSON.parse(json.out);

    expect(printed.findings.map((item: { action: string }) => item.action)).toEqual(["suppressed_duplicate"]);
    expect(printed.comment_plan.line_comments).toEqual([]);

    expect(printed.comment_plan.summary.body).toBe(
      [
        "## Kerpeten review",
        `Reviewed commit ${head}. Line comments in this run: 0. Findings that already had a line comment: 1.`,
        `<!-- kerpeten:summary v1 head=${head} -->`,
      ].join("\n\n"),
    );
  });

  test("a marker for another commit or other lines, one that does not end its comment and one in the conversation write nothing off", async () => {
    const { dir, base, head } = repo();
    const marker = CommentMarker.finding(head, "src/a.ts", 2, 2).line();

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      {
        [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) },
        [COMMENTS.comments]: {
          stdout: slurped([
            lineComment(101, "octocat", `Earlier.\n${CommentMarker.finding(SHA_C, "src/a.ts", 2, 2).line()}`),
            lineComment(102, "octocat", `Other lines.\n${CommentMarker.finding(head, "src/a.ts", 1, 2).line()}`),
            lineComment(103, "octocat", `${marker}\nI quote the marker and go on.`),
          ]),
        },
        [COMMENTS.reviews]: {
          stdout: slurped([{ id: 201, user: { login: "octocat" }, body: `A review.\n${marker}`, state: "COMMENTED" }]),
        },
        [COMMENTS.conversation]: {
          stdout: slurped([
            { id: 301, user: { login: "octocat" }, body: `Quoted.\n${marker}`, created_at: "2026-11-21T10:00:00Z" },
            {
              id: 302,
              user: { login: "octocat" },
              body: `## Kerpeten review\n\n${CommentMarker.summary(head).line()}`,
              created_at: "2026-11-21T10:00:00Z",
            },
          ]),
        },
      },
      { judgeScript: JUDGED_HIGH },
    );

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("comment plan: 1 line comments, 0 in the summary, 0 already written, 0 stored");
    expect(result.err).toContain('"merge request comments read" command=review kerpeten_line=2 kerpeten_summary=1');
  });

  test("comments that could not all be read stop the review with exit code 1 and the reason, before any model call", async () => {
    const { dir, base, head } = repo();

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      {
        [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) },
        [COMMENTS.reviews]: { stdout: slurped([]), stderr: "gh: rate limit\n", exitCode: 1 },
        [COMMENTS.conversation]: { stdout: "<html>busy</html>" },
      },
      { judgeScript: JUDGED_HIGH },
    );

    expect(result.code).toBe(ExitCode.FAILED);

    expect(result.err).toContain(
      "kerpeten review: --mr 12: the comments of the pull request could not all be read, so the review cannot tell which findings are already written: repos/Acme/Shop/pulls/12/reviews: gh api failed (exit 1): gh: rate limit; repos/Acme/Shop/issues/12/comments: the answer of gh is not the list of pages it should be",
    );

    expect(result.out).toBe("");
    expect(result.calls.length).toBe(0);
    expect(ghCalls(result.bin).length).toBe(4);
  });

  test("a sign-in that is gone when the comments are read is a usage error, before any model call", async () => {
    const { dir, base, head } = repo();

    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {
      [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) },
      [COMMENTS.comments]: { exitCode: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login\n" },
    });

    expect(result.code).toBe(ExitCode.USAGE);

    expect(result.err).toContain(
      "kerpeten review: --mr 12: gh is not signed in to github.com: run `gh auth login --hostname github.com` and run again",
    );

    expect(result.out).toBe("");
    expect(result.calls.length).toBe(0);
  });

  test("the comments are read after the working copy is checked, so a wrong commit costs no read of them", async () => {
    const { dir, fork, base } = repo();

    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {
      [PULL]: { stdout: pullJson({ headSha: fork, baseSha: base }) },
      [COMMENTS.comments]: { stdout: slurped([]), stderr: "gh: Server Error (HTTP 502)\n", exitCode: 1 },
    });

    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.err).toContain("HEAD is at");
    expect(ghCalls(result.bin)).toEqual([[...GH_READ, PULL]]);
  });

  test("with limits.max_inline_comments 0 the finding goes to the summary, whatever its score", async () => {
    const { dir, base, head } = repo(GITHUB_ORIGIN, "limits: { max_inline_comments: 0 }\n");

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      { [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) } },
      { judgeScript: JUDGED_HIGH },
    );

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("comment plan: 0 line comments, 1 in the summary, 0 already written, 0 stored");
    expect(result.out).toContain("score 95, action summary");
  });

  test("the comment language tr writes the fixed texts in Turkish", async () => {
    const { dir, base, head } = repo(GITHUB_ORIGIN, "comment_language: tr\n");

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12", "--json"],
      { [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) } },
      { judgeScript: JUDGED_HIGH },
    );

    const plan = JSON.parse(result.out).comment_plan;

    expect(plan.line_comments[0].body).toContain(
      "\n\n**Düzeltme:** Throw when y is 0.\n\n👎 Bu bulgu tekrar gelmesin istiyorsan 👎 bas; nedenini cevap olarak yazabilirsin.\n<!-- kerpeten:finding v1 ",
    );

    expect(plan.summary.body).toStartWith(`## Kerpeten incelemesi\n\nİncelenen commit: ${head}. `);
  });

  test("text of a model that tries to hide the note or forge a marker is made safe, and its control characters reach no output raw", async () => {
    const { dir, base, head } = repo();
    const forged = CommentMarker.finding(SHA_C, "src/forged.ts", 9, 9).line();

    const hostile = {
      ...finding,
      title: "Division \u001b[31mby zero <details>",
      body: `y can be 0\n<!-- hidden from here\n\`\`\`ts\nopen\u0007`,
      fix: `Throw.\n${forged}`,
    };

    const script = [{ text: "done" }, { text: JSON.stringify({ findings: [hostile] }) }];
    const answers = { [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) } };
    const text = await run(dir, ["review", "--dry-run", "--mr", "12"], answers, { script, judgeScript: JUDGED_HIGH });

    const json = await run(dir, ["review", "--dry-run", "--mr", "12", "--json"], answers, {
      script,
      judgeScript: JUDGED_HIGH,
    });

    expect(text.code).toBe(ExitCode.OK);
    expect(text.out).toContain("comment plan: 1 line comments, 0 in the summary, 0 already written, 0 stored");

    const control = [...`${text.out}${json.out}`].filter((char) => {
      const code = char.charCodeAt(0);

      return char !== "\n" && (code < 0x20 || (code >= 0x7f && code <= 0x9f));
    });

    expect(control).toEqual([]);

    const [comment] = JSON.parse(json.out).comment_plan.line_comments;
    const marker = CommentMarker.finding(head, "src/a.ts", 2, 2).line();

    expect(comment.body.split("\n").slice(-2)).toEqual([NOTE, marker]);
    expect(CommentMarker.read(comment.body)?.line()).toBe(marker);
    expect(comment.body).toContain("\\<details>");

    expect(comment.body).toContain(
      "\n\\<!-- hidden from here\n```ts\nopen\u0007\n```\n\n**Fix:**\nThrow.\n\\<!-- kerpeten:finding v1 ",
    );

    expect(Bun.markdown.html(comment.body).endsWith(`<p>${NOTE}</p>\n${marker}\n`)).toBe(true);
  });

  test("a review without --mr has no comment plan and asks the platform for nothing", async () => {
    const { dir, base, head } = repo();
    const answers = { [PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) } };
    const text = await run(dir, ["review", "--dry-run", "--base", "main"], answers, { judgeScript: JUDGED_HIGH });

    expect(text.code).toBe(ExitCode.OK);
    expect(text.out).not.toContain("comment plan");
    expect(text.out).not.toContain("merge request");

    expect(text.out.split("\n").slice(1, 4)).toEqual([
      "findings: 1",
      "- src/a.ts:2-2 [bug] Division by zero",
      "  verdict verified, priority P0, nature critical, fix_effort easy, score 95, action inline",
    ]);

    expect(text.err).not.toContain("comment plan");
    expect(text.err).not.toContain("merge request comments read");
    expect(ghCalls(text.bin)).toEqual([]);

    const json = await run(dir, ["review", "--dry-run", "--base", "main", "--json"], answers, {
      judgeScript: JUDGED_HIGH,
    });

    expect(Object.keys(JSON.parse(json.out))).toEqual(["findings", "usage"]);
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
    expect(glabCalls(result.bin)).toEqual([GLAB_READ, GLAB_DISCUSSIONS]);
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

    expect(Object.keys(printed)).toEqual(["merge_request", "findings", "comment_plan", "usage"]);

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

  test("each failure of glab ends the review before any model call, with the flag and what to do: with 2 when the user can put it right, with 1 when GitLab failed", async () => {
    const cases: [CliAnswer, string, ExitCode][] = [
      [
        { exitCode: 1, stderr: "glab: 401 Unauthorized (HTTP 401)\n", stdout: '{"message":"401 Unauthorized"}' },
        "kerpeten review: --mr 12: GitLab at gitlab.com did not accept the sign-in of glab (HTTP 401): run `glab auth login --hostname gitlab.com`, or correct the token in GITLAB_TOKEN when that variable is set, and run again",
        ExitCode.USAGE,
      ],
      [
        { exitCode: 1, stderr: "glab: 404 Not found (HTTP 404)\n", stdout: '{"message":"404 Not found"}' },
        "kerpeten review: --mr 12: merge request 12 was not found in gitlab.com/acme/shop, the project of the origin remote: check the number; GitLab gives the same answer for a private project that glab cannot read, so check too that glab is signed in to gitlab.com (`glab auth login --hostname gitlab.com`) with an account that can read the project; a merge request of another project, such as the one a fork was made from, is not read",
        ExitCode.USAGE,
      ],
      [
        { stdout: mergeRequestJson({ webUrl: "https://gitlab.com/other/shop/-/merge_requests/12" }) },
        'kerpeten review: --mr 12: glab answered with a merge request of "other/shop", not of acme/shop, the project of the origin remote; when the project was renamed or moved, point the origin remote at its new address and run again',
        ExitCode.FAILED,
      ],
      [
        { exitCode: 1, stderr: "glab: 502 Bad Gateway (HTTP 502)\n" },
        "kerpeten review: --mr 12: glab api failed (exit 1): glab: 502 Bad Gateway (HTTP 502)",
        ExitCode.FAILED,
      ],
      [
        { stdout: "<html>busy</html>" },
        "kerpeten review: --mr 12: the answer of glab for merge request 12 cannot be read: it is no JSON",
        ExitCode.FAILED,
      ],
      [
        { stdout: mergeRequestJson({ state: "locked" }) },
        "kerpeten review: --mr 12: merge request 12 is locked: GitLab is merging it right now, so run again when the merge is done",
        ExitCode.FAILED,
      ],
      [
        { stdout: mergeRequestJson({ baseSha: null }) },
        "kerpeten review: --mr 12: merge request 12 has no diff yet, GitLab names no commits for it: push a commit to its branch, or wait until GitLab has made the diff, and run again",
        ExitCode.FAILED,
      ],
    ];

    for (const [answer, message, code] of cases) {
      const { dir } = repo(GITLAB_ORIGIN);

      const result = await run(
        dir,
        ["review", "--dry-run", "--mr", "12"],
        { [MERGE_REQUEST]: answer },
        { cli: "glab" },
      );

      expect({ code: result.code, err: result.err }).toEqual({
        code,
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
      ["api", "--method", "GET", "--output", "ndjson", "--hostname", "git.example.com", "--paginate", DISCUSSIONS],
    ]);

    const github = repo(SELF_HOSTED_ORIGIN, "platform: github\n");

    const onGitHub = await run(github.dir, ["review", "--dry-run", "--mr", "12", "--json"], {
      ...noComments(12, "acme/shop"),
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

    expect(ghCalls(onGitHub.bin).length).toBe(4);

    for (const call of ghCalls(onGitHub.bin)) {
      expect(call.slice(0, 5)).toEqual(["api", "--method", "GET", "--hostname", "git.example.com"]);
      expect(call.at(-1)).toStartWith("repos/acme/shop/");
    }
  });

  test("the platform key wins over the host of the origin remote", async () => {
    const { dir, base, head } = repo(GITLAB_ORIGIN, "platform: github\n");

    const result = await run(dir, ["review", "--dry-run", "--mr", "12"], {
      ...noComments(12, "acme/shop"),
      [LOWER_CASE_PULL]: { stdout: pullJson({ headSha: head, baseSha: base }) },
    });

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("merge request: #12 Add div (open), github github.com, project 4242, tenant default");
    expect(ghCalls(result.bin).length).toBe(4);
    expect(ghCalls(result.bin)[0]).toEqual(["api", "--method", "GET", "--hostname", "gitlab.com", LOWER_CASE_PULL]);
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
    expect(ghCalls(onGitHub.bin).length).toBe(4);

    for (const call of ghCalls(onGitHub.bin)) {
      expect(call.slice(0, 5)).toEqual(GH_READ);
      expect(call.at(-1)).toStartWith("repos/Acme/Shop/");
    }

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
    expect(glabCalls(onGitLab.bin)).toEqual([GLAB_READ, GLAB_DISCUSSIONS]);
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
    expect(glabCalls(result.bin)).toEqual([GLAB_READ, GLAB_DISCUSSIONS]);
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

describe("kerpeten review --dry-run --mr on a GitLab repository: the comment plan", () => {
  test("a merge request without discussions gets the plan of a first review, read with one more call of glab", async () => {
    const { dir, base, head } = repo(GITLAB_ORIGIN);
    const answers = { [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: head, baseSha: base }) } };

    const text = await run(dir, ["review", "--dry-run", "--mr", "12"], answers, {
      cli: "glab",
      judgeScript: JUDGED_HIGH,
    });

    expect(text.code).toBe(ExitCode.OK);

    expect(text.out.split("\n").slice(2, 6)).toEqual([
      "findings: 1",
      "comment plan: 1 line comments, 0 in the summary, 0 already written, 0 stored",
      "- src/a.ts:2-2 [bug] Division by zero",
      "  verdict verified, priority P0, nature critical, fix_effort easy, score 95, action inline",
    ]);

    expect(text.err).toContain('"merge request comments read" command=review kerpeten_line=0 kerpeten_summary=0');
    expect(glabCalls(text.bin)).toEqual([GLAB_READ, GLAB_DISCUSSIONS]);
    expect(ghCalls(text.bin)).toEqual([]);

    const json = await run(dir, ["review", "--dry-run", "--mr", "12", "--json"], answers, {
      cli: "glab",
      judgeScript: JUDGED_HIGH,
    });

    expect(JSON.parse(json.out).comment_plan).toEqual({
      line_comments: [
        {
          file: "src/a.ts",
          start_line: 2,
          end_line: 2,
          body: [
            "**Division by zero** · bug · P0",
            "",
            "y can be 0",
            "",
            "**Fix:** Throw when y is 0.",
            "",
            NOTE,
            `<!-- kerpeten:finding v1 head=${head} file=c3JjL2EudHM lines=2-2 -->`,
          ].join("\n"),
        },
      ],
      summary: {
        body: [
          "## Kerpeten review",
          `Reviewed commit ${head}. Line comments in this run: 1.`,
          `<!-- kerpeten:summary v1 head=${head} -->`,
        ].join("\n\n"),
      },
    });
  });

  test("a note in the diff that ends with Kerpeten's marker makes the finding already written, by the marker alone and not by where GitLab says the note sits", async () => {
    const { dir, base, head } = repo(GITLAB_ORIGIN);
    const marker = CommentMarker.finding(head, "src/a.ts", 2, 2).line();
    const elsewhere = position({ new_path: "other.ts", old_path: "other.ts", new_line: 7, head_sha: SHA_C });

    const answers = {
      [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: head, baseSha: base }) },
      [DISCUSSIONS]: {
        stdout: jsonLines(
          discussion("d1", note(101, { body: "Why now?" })),
          discussion(
            "d2",
            note(102, {
              type: "DiffNote",
              body: `**Division by zero** · bug · P0\n\n${NOTE}\n${marker}`,
              position: elsewhere,
            }),
            note(103, { type: "DiffNote", body: "Agreed.", position: elsewhere }),
          ),
          discussion("d3", note(104, { body: `## Kerpeten review\n\n${CommentMarker.summary(head).line()}` })),
        ),
      },
    };

    const text = await run(dir, ["review", "--dry-run", "--mr", "12"], answers, {
      cli: "glab",
      judgeScript: JUDGED_HIGH,
    });

    expect(text.code).toBe(ExitCode.OK);
    expect(text.out).toContain("comment plan: 0 line comments, 0 in the summary, 1 already written, 0 stored");
    expect(text.out).toContain("score 95, action suppressed_duplicate");
    expect(text.err).toContain('"merge request comments read" command=review kerpeten_line=1 kerpeten_summary=1');
    expect(ghCalls(text.bin)).toEqual([]);

    const json = await run(dir, ["review", "--dry-run", "--mr", "12", "--json"], answers, {
      cli: "glab",
      judgeScript: JUDGED_HIGH,
    });

    const printed = JSON.parse(json.out);

    expect(printed.findings.map((item: { action: string }) => item.action)).toEqual(["suppressed_duplicate"]);
    expect(printed.comment_plan.line_comments).toEqual([]);

    expect(printed.comment_plan.summary.body).toBe(
      [
        "## Kerpeten review",
        `Reviewed commit ${head}. Line comments in this run: 0. Findings that already had a line comment: 1.`,
        `<!-- kerpeten:summary v1 head=${head} -->`,
      ].join("\n\n"),
    );
  });

  test("the marker in a note outside the diff, a marker for another commit, and a note on the finding's own line without a marker write nothing off", async () => {
    const { dir, base, head } = repo(GITLAB_ORIGIN);
    const marker = CommentMarker.finding(head, "src/a.ts", 2, 2).line();
    const onTheLine = position({ new_line: 2, head_sha: head, base_sha: base });

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      {
        [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: head, baseSha: base }) },
        [DISCUSSIONS]: {
          stdout: jsonLines(
            discussion("d1", note(101, { body: `Quoted in the conversation.\n${marker}` })),
            discussion("d2", note(102, { type: "DiffNote", body: "y can be 0, I think.", position: onTheLine })),
            discussion(
              "d3",
              note(103, {
                type: "DiffNote",
                body: `Earlier.\n${CommentMarker.finding(SHA_C, "src/a.ts", 2, 2).line()}`,
                position: onTheLine,
              }),
            ),
            discussion("d4", note(104, { type: "DiffNote", body: `${marker}\nand I go on.`, position: onTheLine })),
          ),
        },
      },
      { cli: "glab", judgeScript: JUDGED_HIGH },
    );

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("comment plan: 1 line comments, 0 in the summary, 0 already written, 0 stored");
    expect(result.err).toContain('"merge request comments read" command=review kerpeten_line=1 kerpeten_summary=0');
  });

  test("discussions that could not all be read stop the review with exit code 1 and the reason, in GitLab's words, before any model call", async () => {
    const { dir, base, head } = repo(GITLAB_ORIGIN);

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      {
        [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: head, baseSha: base }) },
        [DISCUSSIONS]: {
          stdout: `${jsonLines(discussion("d1", note(101)))}{"id":"d2","notes":[{"id":102,"bo`,
          stderr: "glab: 502 Bad Gateway (HTTP 502)\n",
          exitCode: 1,
        },
      },
      { cli: "glab", judgeScript: JUDGED_HIGH },
    );

    expect(result.code).toBe(ExitCode.FAILED);

    expect(result.err).toContain(
      "kerpeten review: --mr 12: the comments of the merge request could not all be read, so the review cannot tell which findings are already written: projects/acme%2Fshop/merge_requests/12/discussions: glab api failed (exit 1): glab: 502 Bad Gateway (HTTP 502)",
    );

    expect(result.out).toBe("");
    expect(result.calls.length).toBe(0);
    expect(glabCalls(result.bin)).toEqual([GLAB_READ, GLAB_DISCUSSIONS]);
    expect(ghCalls(result.bin)).toEqual([]);

    const garbled = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      {
        [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: head, baseSha: base }) },
        [DISCUSSIONS]: { stdout: `${jsonLines(discussion("d1", note(101)), { id: 7 })}<html>busy</html>` },
      },
      { cli: "glab", judgeScript: JUDGED_HIGH },
    );

    expect(garbled.code).toBe(ExitCode.FAILED);

    expect(garbled.err).toContain(
      "the comments of the merge request could not all be read, so the review cannot tell which findings are already written: projects/acme%2Fshop/merge_requests/12/discussions: the answer of glab is not the lines of entries it should be; projects/acme%2Fshop/merge_requests/12/discussions: 1 of 2 entries cannot be read",
    );

    expect(garbled.calls.length).toBe(0);
  });

  test("a sign-in GitLab no longer accepts when the discussions are read is a usage error, before any model call", async () => {
    const { dir, base, head } = repo(GITLAB_ORIGIN);

    const result = await run(
      dir,
      ["review", "--dry-run", "--mr", "12"],
      {
        [MERGE_REQUEST]: { stdout: mergeRequestJson({ sha: head, baseSha: base }) },
        [DISCUSSIONS]: {
          exitCode: 1,
          stderr: "glab: 401 Unauthorized (HTTP 401)\n",
          stdout: '{"message":"401 Unauthorized"}',
        },
      },
      { cli: "glab" },
    );

    expect(result.code).toBe(ExitCode.USAGE);

    expect(result.err).toContain(
      "kerpeten review: --mr 12: GitLab at gitlab.com did not accept the sign-in of glab (HTTP 401): run",
    );

    expect(result.out).toBe("");
    expect(result.calls.length).toBe(0);
  });
});

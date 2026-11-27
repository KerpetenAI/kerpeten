import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KerpetenApp } from "../../src/app/KerpetenApp.ts";
import { ExitCode } from "../../src/harness-kit/index.ts";
import { tempHome } from "../capability/chatgpt/chatgpt-utils.ts";
import { FakeChatGpt } from "../capability/chatgpt/FakeChatGpt.ts";
import type { KerpetenRun } from "./types/auth.ts";

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

async function kerpeten(home: string, argv: string[], run: KerpetenRun = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const browsing: Promise<Response>[] = [];

  const code = await KerpetenApp.run(
    {
      io: {
        out: (line) => out.push(line),
        err: (line) => {
          err.push(line);

          if (line.startsWith(fake.endpoints.authorizeUrl)) browsing.push(fake.browse(line));
        },
      },
      env: { HOME: home, ...run.env },
      chatgpt: fake.endpoints,
      ...(run.now === undefined ? {} : { now: run.now }),
    },
    argv,
  );

  await Promise.all(browsing);

  return { code, out: out.join("\n"), err: err.join("\n") };
}

function leaks(text: string): string[] {
  return [...fake.issuedTokens, FakeChatGpt.CODE_PREFIX].filter((secret) => text.includes(secret));
}

describe("kerpeten auth", () => {
  test("login, status, status --models and logout", async () => {
    const home = tempHome(dirs);
    const login = await kerpeten(home, ["auth", "login"]);

    expect(login.code).toBe(ExitCode.OK);
    expect(login.err).toContain("Continue with ChatGPT");
    expect(login.out).toContain("signed in to ChatGPT as someone@example.invalid");
    expect(login.out).toContain("You're using your ChatGPT plan");
    expect(login.out).toContain("https://chatgpt.com/settings/usage");

    const status = await kerpeten(home, ["auth", "status"]);

    expect(status.code).toBe(ExitCode.OK);
    expect(status.out).toContain("ChatGPT: signed in as someone@example.invalid");
    expect(status.out).toContain("plan usage: allowed");
    expect(status.out).toContain(`${home}/.config/kerpeten/auth.json`);

    const models = await kerpeten(home, ["auth", "status", "--models"]);

    expect(models.out).toContain("model: plan-model (Plan Model)");
    expect(models.out).not.toContain("hidden-model");

    const logout = await kerpeten(home, ["auth", "logout"]);

    expect(logout.code).toBe(ExitCode.OK);
    expect(logout.out).toContain("signed out of ChatGPT on this machine");

    expect(fake.requests("/api/accounts/oauth/revoke")[0]?.form).toEqual({
      token: "fake-refresh-token-1",
      token_type_hint: "refresh_token",
      client_id: "oaiapp_fake_client",
    });

    const after = await kerpeten(home, ["auth", "status"]);

    expect(after.out).toContain("not signed in");

    const again = await kerpeten(home, ["auth", "login"]);

    expect(again.code).toBe(ExitCode.OK);
    expect(again.out).not.toContain("You're using your ChatGPT plan");

    for (const run of [login, status, models, logout, after, again]) {
      expect(leaks(run.out + run.err)).toEqual([]);
    }
  });

  test("an unknown action or a stray flag is a usage error", async () => {
    const home = tempHome(dirs);

    expect((await kerpeten(home, ["auth"])).code).toBe(ExitCode.USAGE);
    expect((await kerpeten(home, ["auth", "whoami"])).code).toBe(ExitCode.USAGE);
    expect((await kerpeten(home, ["auth", "login", "--models"])).code).toBe(ExitCode.USAGE);
  });

  test("logout without a sign-in does nothing", async () => {
    const result = await kerpeten(tempHome(dirs), ["auth", "logout"]);

    expect(result.code).toBe(ExitCode.OK);
    expect(result.out).toContain("not signed in");
    expect(fake.requests("/api/accounts/oauth/revoke")).toHaveLength(0);
  });

  test("logout that the server does not confirm keeps the sign-in so that it can be retried", async () => {
    const home = tempHome(dirs);

    await kerpeten(home, ["auth", "login"]);

    fake.options.revokeStatus = 503;

    const refused = await kerpeten(home, ["auth", "logout"]);

    expect(refused.code).toBe(ExitCode.FAILED);
    expect(refused.err).toContain("the ChatGPT server did not confirm the sign-out");
    expect(refused.err).toContain("run `kerpeten auth logout` again");
    expect(refused.err).toContain(`${home}/.config/kerpeten/auth.json`);
    expect(refused.out).not.toContain("signed out of ChatGPT on this machine");
    expect((await kerpeten(home, ["auth", "status"])).out).toContain("ChatGPT: signed in as");

    fake.options.revokeStatus = 200;

    const retried = await kerpeten(home, ["auth", "logout"]);

    expect(retried.code).toBe(ExitCode.OK);
    expect(retried.out).toContain("signed out of ChatGPT on this machine");

    expect(fake.requests("/api/accounts/oauth/revoke").map((request) => request.form.token)).toEqual([
      "fake-refresh-token-1",
      "fake-refresh-token-1",
    ]);

    expect((await kerpeten(home, ["auth", "status"])).out).toContain("not signed in");
  });

  test("a sign-in file that is not valid tells how to start over, and that advice works", async () => {
    const home = tempHome(dirs);
    const path = join(home, ".config", "kerpeten", "auth.json");

    mkdirSync(join(home, ".config", "kerpeten"), { recursive: true, mode: 0o700 });
    writeFileSync(path, "{ not json", { mode: 0o600 });

    const broken = await kerpeten(home, ["auth", "login"]);

    expect(broken.code).toBe(ExitCode.FAILED);
    expect(broken.err).toContain(`remove ${path} and run \`kerpeten auth login\``);

    writeFileSync(path, JSON.stringify({ version: 7 }), { mode: 0o600 });

    const invalid = await kerpeten(home, ["auth", "login"]);

    expect(invalid.code).toBe(ExitCode.FAILED);
    expect(invalid.err).toContain(`remove ${path} and run \`kerpeten auth login\``);

    rmSync(path);

    expect((await kerpeten(home, ["auth", "login"])).code).toBe(ExitCode.OK);
  });

  test("a sign-in file that others can read asks for chmod, and that advice works", async () => {
    const home = tempHome(dirs);

    await kerpeten(home, ["auth", "login"]);

    const path = join(home, ".config", "kerpeten", "auth.json");

    chmodSync(path, 0o644);

    const open = await kerpeten(home, ["auth", "login"]);

    expect(open.code).toBe(ExitCode.FAILED);
    expect(open.err).toContain(`run \`chmod 600 ${path}\``);
    expect(open.err).not.toContain("kerpeten auth login");

    chmodSync(path, 0o600);

    expect((await kerpeten(home, ["auth", "login"])).code).toBe(ExitCode.OK);
  });

  test("a config directory inside a git repository is refused and nothing is written there", async () => {
    const home = tempHome(dirs);
    const repo = tempHome(dirs);

    mkdirSync(join(repo, ".git"));

    const result = await kerpeten(home, ["auth", "login"], { env: { XDG_CONFIG_HOME: join(repo, "config") } });

    expect(result.code).toBe(ExitCode.USAGE);
    expect(result.err).toContain(`is inside the git repository ${repo}`);
    expect(result.err).toContain("XDG_CONFIG_HOME");
    expect(existsSync(join(repo, "config"))).toBe(false);
    expect(fake.requests("/api/accounts/oauth/token")).toHaveLength(0);
  });

  test("status --models shows the token state after the model list refreshed the token", async () => {
    const home = tempHome(dirs);

    await kerpeten(home, ["auth", "login"]);

    const later = Date.now() + 2 * 3600 * 1000;
    const models = await kerpeten(home, ["auth", "status", "--models"], { now: () => later });

    expect(models.code).toBe(ExitCode.OK);
    expect(models.out).toContain("model: plan-model (Plan Model)");
    expect(models.out).not.toContain("expired");
    expect(models.out).toContain(`access token: valid until ${new Date(later + 3600 * 1000).toISOString()}`);
  });

  test("status --models still shows the sign-in when the model list fails", async () => {
    const home = tempHome(dirs);

    await kerpeten(home, ["auth", "login"]);

    fake.options.refreshMode = "down";

    const later = Date.now() + 2 * 3600 * 1000;
    const models = await kerpeten(home, ["auth", "status", "--models"], { now: () => later });

    expect(models.code).toBe(ExitCode.FAILED);
    expect(models.out).toContain("ChatGPT: signed in as someone@example.invalid");
    expect(models.out).toContain("access token: expired, refreshed on next use");
    expect(models.out).not.toContain("model:");
    expect(models.err).not.toBe("");
  });
});

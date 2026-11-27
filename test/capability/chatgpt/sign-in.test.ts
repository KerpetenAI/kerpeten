import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { authFilePath } from "../../../src/capability/chatgpt/chatgpt-utils.ts";
import { fileText, mode, plan, signIn, tempHome } from "./chatgpt-utils.ts";
import { FakeChatGpt } from "./FakeChatGpt.ts";

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

describe("ChatGPT sign-in", () => {
  test("the first sign-in registers Kerpeten with PKCE, a loopback callback and the plan scopes", async () => {
    const home = tempHome(dirs);
    const chatgpt = await plan(fake, home);
    const { settled, url, page } = await signIn(fake, chatgpt);

    expect(settled.ok).toBe(true);
    expect(page).toContain("Kerpeten is signed in");
    expect(url.origin + url.pathname).toBe(fake.endpoints.authorizeUrl);

    const params = Object.fromEntries(url.searchParams);

    expect(params).toMatchObject({
      client_id: "dynamic_agent_client",
      agent_name_hint: "Kerpeten",
      response_type: "code",
      scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource: "https://api.openai.com/v1",
      code_challenge_method: "S256",
    });

    expect(params.ext_agent_host_id).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
    expect(params.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback$/);
    expect(params.state?.length).toBeGreaterThanOrEqual(32);
    expect(params.nonce?.length).toBeGreaterThanOrEqual(32);
    expect(params).not.toHaveProperty("login_hint");
    expect(params).not.toHaveProperty("id_token_hint");
    expect(params).not.toHaveProperty("prompt");

    const [exchange] = fake.requests("/api/accounts/oauth/token");

    expect(exchange?.form).toMatchObject({
      grant_type: "authorization_code",
      client_id: "oaiapp_fake_client",
      redirect_uri: params.redirect_uri,
      resource: "https://api.openai.com/v1",
    });

    expect(exchange?.form).not.toHaveProperty("client_secret");

    const path = join(home, ".config", "kerpeten", "auth.json");
    const record = JSON.parse(fileText(path));

    expect(path).toBe(chatgpt.file.path);
    expect(mode(path)).toBe(0o600);
    expect(mode(dirname(path))).toBe(0o700);

    expect(record).toMatchObject({
      version: 1,
      host_id: params.ext_agent_host_id,
      client_id: "oaiapp_fake_client",
      subject: "fake-subject-1",
      email: "someone@example.invalid",
      plan_usage: "granted",
      tokens: {
        access_token: "fake-access-token-1",
        refresh_token: "fake-refresh-token-1",
        scopes: ["chatgpt.tokens.use.direct", "email", "offline_access", "openid", "profile", "resource.invoke"],
      },
    });

    expect(fileText(path)).not.toContain("fake-auth-code");
    expect(fileText(path)).not.toContain("id_token");
  });

  test("a later sign-in reuses the issued client and the host ID and sends no app name", async () => {
    const home = tempHome(dirs);
    const first = await signIn(fake, await plan(fake, home));
    const second = await signIn(fake, await plan(fake, home));

    expect(second.settled.ok).toBe(true);
    expect(second.url.searchParams.get("client_id")).toBe("oaiapp_fake_client");
    expect(second.url.searchParams.get("ext_agent_host_id")).toBe(first.url.searchParams.get("ext_agent_host_id"));
    expect(second.url.searchParams.has("agent_name_hint")).toBe(false);
    expect(second.url.searchParams.get("login_hint")).toBe("someone@example.invalid");
  });

  test("a callback with another state is refused and the sign-in waits for its own callback", async () => {
    const chatgpt = await plan(fake, tempHome(dirs));
    let foreign: Response | undefined;
    let browsing: Promise<Response> | undefined;

    const result = chatgpt.signIn.run({
      show: (url) => {
        browsing = fake.browse(url, { state: "not-the-state" }).then((response) => {
          foreign = response;

          return fake.browse(url);
        });
      },
      timeoutMs: 5000,
    });

    const { record } = await result;
    const page = await browsing;

    expect(foreign?.status).toBe(400);
    expect(await foreign?.text()).toContain("sign-in failed");
    expect(await page?.text()).toContain("Kerpeten is signed in");
    expect(record.tokens?.access_token).toBe("fake-access-token-1");
    expect(fake.requests("/api/accounts/oauth/token")).toHaveLength(1);
  });

  test("a sign-in that only gets callbacks with another state times out and says they were refused", async () => {
    const chatgpt = await plan(fake, tempHome(dirs));
    let browsing: Promise<Response> | undefined;

    const result = chatgpt.signIn.run({
      show: (url) => {
        browsing = fake.browse(url, { state: "not-the-state" });
      },
      timeoutMs: 300,
    });

    const error = await result.catch((caught: unknown) => caught);

    expect(String(error)).toContain("no answer from the browser in time");
    expect(String(error)).toContain("1 callback of another sign-in was refused");
    expect((await browsing)?.status).toBe(400);
    expect(chatgpt.file.read()?.tokens).toBeUndefined();
    expect(fake.requests("/api/accounts/oauth/token")).toHaveLength(0);
  });

  test("a declined sign-in stops without a code exchange", async () => {
    const chatgpt = await plan(fake, tempHome(dirs));
    const { settled } = await signIn(fake, chatgpt, { error: "access_denied" });

    expect(settled).toMatchObject({ ok: false, error: expect.stringContaining("declined") });
    expect(fake.requests("/api/accounts/oauth/token")).toHaveLength(0);
  });

  test("a first callback without an issued client ID is an incomplete registration", async () => {
    const chatgpt = await plan(fake, tempHome(dirs));
    const { settled } = await signIn(fake, chatgpt, { clientId: null });

    expect(settled).toMatchObject({ ok: false, error: expect.stringContaining("registration is incomplete") });
  });

  test("an ID token with another nonce is refused", async () => {
    fake.options.nonceOverride = "another-nonce";

    const chatgpt = await plan(fake, tempHome(dirs));
    const { settled, page } = await signIn(fake, chatgpt);

    expect(settled).toMatchObject({ ok: false, error: expect.stringContaining("nonce") });
    expect(page).toContain("sign-in failed");
    expect(page).not.toContain("Kerpeten is signed in");
    expect(chatgpt.file.read()?.tokens).toBeUndefined();
  });

  test("an ID token whose payload does not match its signature is refused", async () => {
    fake.options.tamper = true;

    const chatgpt = await plan(fake, tempHome(dirs));
    const { settled } = await signIn(fake, chatgpt);

    expect(settled).toMatchObject({ ok: false, error: expect.stringContaining("signature does not match") });
    expect(chatgpt.file.read()?.tokens).toBeUndefined();
  });

  test("without the plan scope the sign-in is kept as declined and the next one asks for consent", async () => {
    fake.options.grantedScope = "email openid profile offline_access";

    const home = tempHome(dirs);
    const { settled } = await signIn(fake, await plan(fake, home));

    expect(settled).toMatchObject({ ok: false, error: expect.stringContaining("plan usage was not allowed") });

    const record = (await plan(fake, home)).file.read();

    expect(record).toMatchObject({ plan_usage: "declined", client_id: "oaiapp_fake_client" });
    expect(record?.tokens).toBeUndefined();

    fake.options.grantedScope = "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke";

    const again = await signIn(fake, await plan(fake, home));

    expect(again.url.searchParams.get("prompt")).toBe("consent");
    expect(again.settled.ok).toBe(true);
  });

  test("a token response without a scope grants the requested scopes", async () => {
    fake.options.grantedScope = undefined;

    const home = tempHome(dirs);
    const { settled } = await signIn(fake, await plan(fake, home));

    expect(settled.ok).toBe(true);

    const chatgpt = await plan(fake, home);

    expect(chatgpt.file.read()).toMatchObject({
      plan_usage: "granted",
      tokens: {
        scopes: ["openid", "profile", "email", "offline_access", "resource.invoke", "chatgpt.tokens.use.direct"],
      },
    });

    expect(await chatgpt.tokens.accessToken()).toBe("fake-access-token-1");
  });

  test("the file goes under XDG_CONFIG_HOME when it is set and HOME otherwise", () => {
    expect(authFilePath({ XDG_CONFIG_HOME: "/x/cfg", HOME: "/home/u" })).toBe("/x/cfg/kerpeten/auth.json");
    expect(authFilePath({ XDG_CONFIG_HOME: "relative", HOME: "/home/u" })).toBe("/home/u/.config/kerpeten/auth.json");
    expect(() => authFilePath({})).toThrow("config directory");
  });
});

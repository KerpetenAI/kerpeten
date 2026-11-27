import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, rmSync } from "node:fs";
import { ChatGptTokens } from "../../../src/capability/chatgpt/ChatGptTokens.ts";
import { fileText, mode, plan, signIn, tempHome } from "./chatgpt-utils.ts";
import { FakeChatGpt } from "./FakeChatGpt.ts";

const HOUR = 3600 * 1000;

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

async function signedIn() {
  const home = tempHome(dirs);

  await signIn(fake, await plan(fake, home));

  return home;
}

describe("ChatGPT tokens", () => {
  test("a fresh access token is handed out without a refresh", async () => {
    const home = await signedIn();

    expect(await (await plan(fake, home)).tokens.accessToken()).toBe("fake-access-token-1");
    expect(fake.requests("/api/accounts/oauth/token")).toHaveLength(1);
  });

  test("near expiry the token is refreshed and the rotated refresh token is saved first", async () => {
    const home = await signedIn();
    const later = await plan(fake, home, () => Date.now() + HOUR - ChatGptTokens.REFRESH_MARGIN_MS / 2);

    expect(await later.tokens.accessToken()).toBe("fake-access-token-2");

    const refresh = fake.requests("/api/accounts/oauth/token")[1];

    expect(refresh?.form).toEqual({
      grant_type: "refresh_token",
      client_id: "oaiapp_fake_client",
      refresh_token: "fake-refresh-token-1",
      resource: "https://api.openai.com/v1",
    });

    expect(later.file.read()?.tokens).toMatchObject({
      access_token: "fake-access-token-2",
      refresh_token: "fake-refresh-token-2",
    });

    expect(mode(later.file.path)).toBe(0o600);
  });

  test("parallel callers share one refresh", async () => {
    const home = await signedIn();
    const later = await plan(fake, home, () => Date.now() + 2 * HOUR);
    const tokens = await Promise.all([1, 2, 3, 4].map(() => later.tokens.accessToken()));

    expect(new Set(tokens)).toEqual(new Set(["fake-access-token-2"]));
    expect(fake.requests("/api/accounts/oauth/token")).toHaveLength(2);
  });

  test("a rejected refresh token clears the tokens and asks for a new sign-in", async () => {
    const home = await signedIn();
    const later = await plan(fake, home, () => Date.now() + 2 * HOUR);

    fake.options.refreshMode = "invalid_grant";

    const error = await later.tokens.accessToken().catch((caught: unknown) => caught);

    expect(String(error)).toContain("kerpeten auth login");
    expect(String(error)).not.toContain("fake-refresh-token");

    const record = later.file.read();

    expect(record?.tokens).toBeUndefined();
    expect(record?.client_id).toBe("oaiapp_fake_client");
  });

  test("a refresh rejected because another process already rotated the token uses that process's tokens", async () => {
    const home = await signedIn();
    const later = await plan(fake, home, () => Date.now() + HOUR - ChatGptTokens.REFRESH_MARGIN_MS / 2);
    const record = later.file.read();

    fake.options.refreshMode = "invalid_grant";

    const writeRotated = () => {
      if (record?.tokens === undefined) return;

      later.file.write({
        ...record,
        tokens: {
          ...record.tokens,
          access_token: "fake-access-token-other",
          refresh_token: "fake-refresh-token-other",
          expires_at: Date.now() + 2 * HOUR,
        },
      });
    };

    const refreshing = later.tokens.accessToken();

    writeRotated();

    expect(await refreshing).toBe("fake-access-token-other");
    expect(later.file.read()?.tokens?.refresh_token).toBe("fake-refresh-token-other");
  });

  test("a sign-out during a refresh is kept, and the token the refresh got is revoked", async () => {
    const home = await signedIn();
    const later = await plan(fake, home, () => Date.now() + 2 * HOUR);
    const record = later.file.read();
    const refreshing = later.tokens.accessToken();

    if (record !== undefined) later.file.clearTokens(record);

    const error = await refreshing.catch((caught: unknown) => caught);

    expect(String(error)).toContain("signed out of ChatGPT while the access token was being refreshed");
    expect(String(error)).not.toContain("fake-refresh-token");
    expect(later.file.read()?.tokens).toBeUndefined();
    expect(fileText(later.file.path)).not.toContain("fake-access-token-2");

    expect(fake.requests("/api/accounts/oauth/revoke").map((request) => request.form.token)).toEqual([
      "fake-refresh-token-2",
    ]);
  });

  test("an unreachable server keeps a token that is still valid and fails once it has expired", async () => {
    const home = await signedIn();

    fake.options.refreshMode = "down";

    const soon = await plan(fake, home, () => Date.now() + HOUR - ChatGptTokens.REFRESH_MARGIN_MS / 2);

    expect(await soon.tokens.accessToken()).toBe("fake-access-token-1");

    const expired = await plan(fake, home, () => Date.now() + 2 * HOUR);
    const error = await expired.tokens.accessToken().catch((caught: unknown) => caught);

    expect(String(error)).toContain("could not be refreshed");
    expect(expired.file.read()?.tokens?.refresh_token).toBe("fake-refresh-token-1");
  });

  test("without a sign-in the token source says to sign in", async () => {
    const error = await (await plan(fake, tempHome(dirs))).tokens.accessToken().catch((caught: unknown) => caught);

    expect(String(error)).toContain("not signed in to ChatGPT; run `kerpeten auth login`");
  });

  test("a sign-in file that others can read is refused", async () => {
    const home = await signedIn();
    const chatgpt = await plan(fake, home);

    chmodSync(chatgpt.file.path, 0o644);

    expect(() => chatgpt.file.read()).toThrow("can be read by other users");
    expect(fileText(chatgpt.file.path)).toContain("fake-access-token-1");
  });
});

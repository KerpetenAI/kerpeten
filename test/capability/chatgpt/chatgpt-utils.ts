import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IocApplication } from "@asenajs/ioc";
import { Names } from "../../../src/app/Names.ts";
import type { Instances } from "../../../src/app/types/app.ts";
import { ChatGptAuthFile } from "../../../src/capability/chatgpt/ChatGptAuthFile.ts";
import { ChatGptOAuth } from "../../../src/capability/chatgpt/ChatGptOAuth.ts";
import { ChatGptPlan } from "../../../src/capability/chatgpt/ChatGptPlan.ts";
import { ChatGptSignIn } from "../../../src/capability/chatgpt/ChatGptSignIn.ts";
import { ChatGptTokens } from "../../../src/capability/chatgpt/ChatGptTokens.ts";
import { quietLogger } from "../../harness-kit/harness-kit-utils.ts";
import type { FakeChatGpt } from "./FakeChatGpt.ts";
import type { BrowseOptions, ChatGptParts } from "./types/fake.ts";

export function tempHome(dirs: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "kerpeten-chatgpt-"));

  dirs.push(dir);

  return dir;
}

/** The ChatGPT parts from a container of their own, with the fake server's endpoints and `home` as the home directory. */
export async function plan(fake: FakeChatGpt, home: string, now: () => number = Date.now): Promise<ChatGptParts> {
  const instances: Pick<Instances, Names.ENV | Names.CHATGPT_ENDPOINTS | Names.NOW> = {
    [Names.ENV]: { HOME: home },
    [Names.CHATGPT_ENDPOINTS]: fake.endpoints,
    [Names.NOW]: now,
  };

  const app = await IocApplication.create({
    components: [ChatGptAuthFile, ChatGptOAuth, ChatGptTokens, ChatGptSignIn, ChatGptPlan],
    instances: { ...instances },
    logger: quietLogger(),
  });

  await app.start();

  return {
    file: await app.resolve(ChatGptAuthFile),
    oauth: await app.resolve(ChatGptOAuth),
    tokens: await app.resolve(ChatGptTokens),
    signIn: await app.resolve(ChatGptSignIn),
    plan: await app.resolve(ChatGptPlan),
  };
}

export async function signIn(fake: FakeChatGpt, chatgpt: ChatGptParts, browse: BrowseOptions = {}) {
  const urls: string[] = [];
  let browsing: Promise<Response> | undefined;

  const result = chatgpt.signIn.run({
    show: (url) => {
      urls.push(url);
      browsing = fake.browse(url, browse);
    },
    timeoutMs: 5000,
  });

  const settled = await result.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error: error instanceof Error ? error.message : String(error) }),
  );

  const page = await browsing;

  return { settled, url: new URL(urls[0] ?? ""), page: page === undefined ? "" : await page.text() };
}

export function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

export function fileText(path: string): string {
  return readFileSync(path, "utf8");
}

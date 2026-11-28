import { describe, expect, test } from "bun:test";
import { IocApplication } from "@asenajs/ioc";
import { Names } from "../../../src/app/Names.ts";
import { ChatGptAuthFile } from "../../../src/capability/chatgpt/ChatGptAuthFile.ts";
import { ChatGptOAuth } from "../../../src/capability/chatgpt/ChatGptOAuth.ts";
import { ChatGptPlan } from "../../../src/capability/chatgpt/ChatGptPlan.ts";
import { ChatGptSignIn } from "../../../src/capability/chatgpt/ChatGptSignIn.ts";
import { ChatGptTokens } from "../../../src/capability/chatgpt/ChatGptTokens.ts";
import { quietLogger } from "../../test-utils.ts";

describe("the ChatGPT components", () => {
  test("start without a usable environment and find the sign-in file only when it is first used", async () => {
    const app = await IocApplication.create({
      components: [ChatGptAuthFile, ChatGptOAuth, ChatGptTokens, ChatGptSignIn, ChatGptPlan],
      instances: { [Names.ENV]: {}, [Names.CHATGPT_ENDPOINTS]: ChatGptOAuth.PRODUCTION, [Names.NOW]: () => 0 },
      logger: quietLogger(),
    });

    await app.start();

    const file = await app.resolve(ChatGptAuthFile);
    const plan = await app.resolve(ChatGptPlan);

    expect(plan.adapter).toBe(plan.adapter);

    expect(() => file.path).toThrow(
      "cannot find the config directory: neither XDG_CONFIG_HOME nor HOME is an absolute path",
    );

    await expect((await app.resolve(ChatGptTokens)).accessToken()).rejects.toThrow("cannot find the config directory");

    await app.stop();
  });
});

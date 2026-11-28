import { Inject } from "@asenajs/ioc";
import { ExitCode, FlowStep, FlowStepBase, type KitInstances, KitNames } from "@kerpetensh/harness-kit";
import { Names } from "../../../app/Names.ts";
import type { Instances } from "../../../app/types/app.ts";
import { ChatGptAuthFile } from "../../../capability/chatgpt/ChatGptAuthFile.ts";
import { ChatGptOAuth } from "../../../capability/chatgpt/ChatGptOAuth.ts";
import { ChatGptPlan } from "../../../capability/chatgpt/ChatGptPlan.ts";
import { ChatGptSignIn } from "../../../capability/chatgpt/ChatGptSignIn.ts";
import type { AuthRecord } from "../../../capability/chatgpt/types/chatgpt.ts";
import { terminalLine } from "../../../text/text-utils.ts";
import type { AuthInput } from "../types/auth.ts";

/** Signs in to ChatGPT, signs out or shows the sign-in, as the action says, and adds the exit code. */
@FlowStep({
  name: "auth",
  description: "Signs in to ChatGPT, signs out on this machine or shows the sign-in, as the action of the input says.",
})
export class AuthStep extends FlowStepBase {
  @Inject(KitNames.IO)
  private readonly io!: KitInstances[KitNames.IO];

  @Inject(Names.NOW)
  private readonly now!: Instances[Names.NOW];

  @Inject(ChatGptAuthFile)
  private readonly file!: ChatGptAuthFile;

  @Inject(ChatGptOAuth)
  private readonly oauth!: ChatGptOAuth;

  @Inject(ChatGptSignIn)
  private readonly signIn!: ChatGptSignIn;

  @Inject(ChatGptPlan)
  private readonly plan!: ChatGptPlan;

  public async execute(state: AuthInput) {
    return { code: await this.act(state) };
  }

  private async act(state: AuthInput): Promise<number> {
    let path: string;

    try {
      path = this.file.path;
    } catch (error) {
      return this.command.fail(ExitCode.USAGE, ChatGptPlan.failureMessage(error));
    }

    try {
      if (state.action === "login") return await this.login(path);
      if (state.action === "logout") return await this.logout(path);

      return await this.status(path, state.models);
    } catch (error) {
      return this.command.fail(ExitCode.FAILED, terminalLine(ChatGptPlan.failureMessage(error)));
    }
  }

  private async login(path: string): Promise<number> {
    const { io } = this;

    io.err("Continue with ChatGPT: open this address in your browser to sign in Kerpeten.");

    const { record, firstTime } = await this.signIn.run({ show: (url) => io.err(url) });

    io.out(`signed in to ChatGPT as ${terminalLine(record.email ?? record.subject ?? "unknown account")}`);

    if (firstTime) {
      io.out("You're using your ChatGPT plan: reviews with provider chatgpt use your ChatGPT plan's usage.");
      io.out(`Manage usage: ${ChatGptPlan.USAGE_SETTINGS_URL}`);
    }

    io.out(`sign-in saved to ${path}`);

    return ExitCode.OK;
  }

  private async logout(path: string): Promise<number> {
    const { io } = this;
    const record = this.file.read();

    if (record?.tokens === undefined || record.client_id === undefined) {
      io.out("not signed in to ChatGPT");

      return ExitCode.OK;
    }

    if (!(await this.oauth.revoke(record.client_id, record.tokens.refresh_token))) {
      return this.command.fail(
        ExitCode.FAILED,
        `the ChatGPT server did not confirm the sign-out, so the sign-in is kept on this machine; run \`kerpeten auth logout\` again, or disconnect Kerpeten in ChatGPT settings (${ChatGptPlan.USAGE_SETTINGS_URL}) and remove ${path}`,
      );
    }

    this.file.clearTokens(record);

    io.out("signed out of ChatGPT on this machine");

    return ExitCode.OK;
  }

  private async status(path: string, models: boolean): Promise<number> {
    const { io } = this;

    io.out(`file: ${path}`);

    const signedIn = this.file.read()?.tokens !== undefined;
    const [listing] = await Promise.allSettled([models && signedIn ? this.plan.adapter.listModels() : []]);
    const record = this.file.read();

    if (record?.tokens === undefined) io.out("ChatGPT: not signed in; run `kerpeten auth login`");
    else for (const line of this.statusLines(record)) io.out(line);

    if (listing.status === "rejected") throw listing.reason;
    if (record?.tokens === undefined) return models ? ExitCode.FAILED : ExitCode.OK;

    for (const model of listing.value) {
      io.out(`model: ${terminalLine(model.slug)} (${terminalLine(model.displayName)})`);
    }

    return ExitCode.OK;
  }

  private statusLines(record: AuthRecord): readonly string[] {
    const tokens = record.tokens;
    const now = this.now();

    if (tokens === undefined) return [];

    return [
      `ChatGPT: signed in as ${terminalLine(record.email ?? record.subject ?? "unknown account")}`,
      `plan usage: ${record.plan_usage === "granted" ? "allowed" : "not allowed"}`,
      `access token: ${tokens.expires_at > now ? `valid until ${new Date(tokens.expires_at).toISOString()}` : "expired, refreshed on next use"}`,
      `scopes: ${tokens.scopes.join(" ")}`,
    ];
  }
}

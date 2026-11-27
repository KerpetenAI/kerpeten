import { Inject, Service } from "@asenajs/ioc";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { ChatGptAuthError } from "./ChatGptAuthError.ts";
import { ChatGptAuthFile } from "./ChatGptAuthFile.ts";
import { ChatGptOAuth } from "./ChatGptOAuth.ts";
import { storedTokens } from "./chatgpt-utils.ts";
import type { AuthRecord, StoredTokens, UsableSignIn } from "./types/chatgpt.ts";

/**
 * Hands out the access token of the saved ChatGPT sign-in and refreshes it shortly before it expires. One refresh
 * runs at a time in this process; the rotated refresh token is saved before the new access token is used.
 */
@Service("kerpeten:chatgpt-tokens")
export class ChatGptTokens {
  public static readonly REFRESH_MARGIN_MS = 2 * 60 * 1000;

  private static readonly LOGIN = "run `kerpeten auth login`";

  @Inject(ChatGptAuthFile)
  private readonly file!: ChatGptAuthFile;

  @Inject(ChatGptOAuth)
  private readonly oauth!: ChatGptOAuth;

  @Inject(Names.NOW)
  private readonly now!: Instances[Names.NOW];

  private refreshing: Promise<string> | undefined;

  private static usable(record: AuthRecord | undefined): UsableSignIn {
    if (record?.tokens === undefined || record.client_id === undefined) {
      throw new ChatGptAuthError(`not signed in to ChatGPT; ${ChatGptTokens.LOGIN}`);
    }

    if (!record.tokens.scopes.includes(ChatGptOAuth.PLAN_SCOPE)) {
      throw new ChatGptAuthError(`ChatGPT plan usage is not allowed for this sign-in; ${ChatGptTokens.LOGIN}`);
    }

    return { record, tokens: record.tokens, clientId: record.client_id };
  }

  public async accessToken(): Promise<string> {
    const { tokens } = ChatGptTokens.usable(this.file.read());

    if (this.fresh(tokens)) return tokens.access_token;

    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = undefined;
    });

    return this.refreshing;
  }

  private fresh(tokens: StoredTokens): boolean {
    return tokens.expires_at - this.now() > ChatGptTokens.REFRESH_MARGIN_MS;
  }

  private tooEarly(tokens: StoredTokens): boolean {
    const now = this.now();

    return tokens.earliest_refresh_at !== undefined && now < tokens.earliest_refresh_at && now < tokens.expires_at;
  }

  private async refresh(): Promise<string> {
    const { record, tokens, clientId } = ChatGptTokens.usable(this.file.read());

    if (this.fresh(tokens) || this.tooEarly(tokens)) return tokens.access_token;

    const outcome = await this.oauth.refresh(clientId, tokens.refresh_token);

    if (!outcome.ok) {
      if (outcome.unusable) {
        const current = this.file.read()?.tokens;

        if (current !== undefined && current.refresh_token !== tokens.refresh_token && this.fresh(current)) {
          return current.access_token;
        }

        this.file.clearTokens(record);

        throw new ChatGptAuthError(
          `the ChatGPT sign-in has expired or was revoked (${outcome.reason}); ${ChatGptTokens.LOGIN}`,
        );
      }

      if (tokens.expires_at > this.now()) return tokens.access_token;

      throw new ChatGptAuthError(
        `the ChatGPT token could not be refreshed (${outcome.reason}); try again later or ${ChatGptTokens.LOGIN}`,
      );
    }

    const next = storedTokens(outcome.tokens, tokens, this.now());

    if (!next.scopes.includes(ChatGptOAuth.PLAN_SCOPE)) {
      this.file.clearTokens(record);

      throw new ChatGptAuthError(`ChatGPT plan usage is no longer allowed for this sign-in; ${ChatGptTokens.LOGIN}`);
    }

    if (this.file.read()?.tokens === undefined) {
      const revoked = await this.oauth.revoke(clientId, next.refresh_token);

      throw new ChatGptAuthError(
        `signed out of ChatGPT while the access token was being refreshed, so the new token was not saved${revoked ? " and was revoked" : "; the server did not confirm revoking it"}; ${ChatGptTokens.LOGIN}`,
      );
    }

    this.file.write({ ...record, tokens: next });

    return next.access_token;
  }
}

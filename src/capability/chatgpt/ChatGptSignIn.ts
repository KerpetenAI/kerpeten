import { Inject } from "@asenajs/ioc";
import { Capability, CapabilityBase } from "@kerpetensh/harness-kit";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { ChatGptAuthError } from "./ChatGptAuthError.ts";
import { ChatGptAuthFile } from "./ChatGptAuthFile.ts";
import { ChatGptOAuth } from "./ChatGptOAuth.ts";
import { pkcePair, randomValue, scopesOf, storedTokens } from "./chatgpt-utils.ts";
import type { AuthRecord, CallbackOutcome, CallbackResult, SignInOptions, SignInResult } from "./types/chatgpt.ts";

@Capability({
  name: "chatgpt-sign-in",
  description:
    "Signs in to ChatGPT in the user's browser: listens on 127.0.0.1 for the one sign-in callback, then stops listening.",
})
export class ChatGptSignIn extends CapabilityBase {
  public static readonly CALLBACK_PATH = "/auth/callback";

  private static readonly DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

  private static readonly PAGE_DONE =
    "<!doctype html><title>Kerpeten</title><p>Kerpeten is signed in. You can close this tab.</p>";

  private static readonly PAGE_FAILED =
    "<!doctype html><title>Kerpeten</title><p>Kerpeten sign-in failed. See the terminal.</p>";

  @Inject(ChatGptAuthFile)
  private readonly file!: ChatGptAuthFile;

  @Inject(ChatGptOAuth)
  private readonly oauth!: ChatGptOAuth;

  @Inject(Names.NOW)
  private readonly now!: Instances[Names.NOW];

  private static page(ok: boolean): Response {
    return new Response(ok ? ChatGptSignIn.PAGE_DONE : ChatGptSignIn.PAGE_FAILED, {
      status: ok ? 200 : 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  private static refusedNote(refused: number): string {
    if (refused === 0) return "";

    return ` (${refused} callback${refused === 1 ? "" : "s"} of another sign-in ${refused === 1 ? "was" : "were"} refused)`;
  }

  private static callback(url: URL, registering: boolean, savedClientId?: string): CallbackOutcome {
    const error = url.searchParams.get("error");

    if (error !== null) {
      return {
        ok: false,
        error:
          error === "access_denied"
            ? "the sign-in was declined in the browser"
            : `the sign-in server returned an error (${error.replace(/[^A-Za-z0-9_.-]/gu, "?").slice(0, 64)})`,
      };
    }

    const code = url.searchParams.get("code");

    if (code === null || code === "") return { ok: false, error: "the callback carries no authorization code" };

    const clientId = url.searchParams.get("client_id") ?? undefined;

    if (registering && clientId === undefined) {
      return { ok: false, error: "the registration is incomplete: the callback carries no client ID" };
    }

    if (!registering && clientId !== undefined && clientId !== savedClientId) {
      return { ok: false, error: "the callback names a different client than this machine's registration" };
    }

    return { ok: true, result: { code, clientId } };
  }

  /**
   * Runs one sign-in: it opens a listener on a free port of 127.0.0.1, shows the authorization URL, waits for the
   * browser to come back, exchanges the code, checks the ID token and the plan scope, and saves the record.
   */
  public async run(options: SignInOptions): Promise<SignInResult> {
    const saved = this.file.read();
    const hostId = saved?.host_id ?? `urn:uuid:${crypto.randomUUID()}`;

    if (saved === undefined) this.file.write({ version: 1, host_id: hostId });

    const base: AuthRecord = saved ?? { version: 1, host_id: hostId };
    const registering = base.client_id === undefined;
    const state = randomValue();
    const nonce = randomValue();
    const pkce = await pkcePair();
    const { promise, resolve } = Promise.withResolvers<CallbackOutcome>();
    const signedIn = Promise.withResolvers<boolean>();
    let refused = 0;

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url);

        if (url.pathname !== ChatGptSignIn.CALLBACK_PATH) return new Response("not found", { status: 404 });

        if (url.searchParams.get("state") !== state) {
          refused++;

          return ChatGptSignIn.page(false);
        }

        const outcome = ChatGptSignIn.callback(url, registering, base.client_id);

        resolve(outcome);

        return outcome.ok ? signedIn.promise.then(ChatGptSignIn.page) : ChatGptSignIn.page(false);
      },
    });

    const redirectUri = `http://127.0.0.1:${server.port}${ChatGptSignIn.CALLBACK_PATH}`;
    const timeout = options.timeoutMs ?? ChatGptSignIn.DEFAULT_TIMEOUT_MS;

    const timer = setTimeout(
      () => resolve({ ok: false, error: `no answer from the browser in time${ChatGptSignIn.refusedNote(refused)}` }),
      timeout,
    );

    try {
      options.show(
        this.oauth.authorizeUrl({
          clientId: base.client_id,
          hostId,
          redirectUri,
          state,
          nonce,
          challenge: pkce.challenge,
          loginHint: base.email,
          consent: base.plan_usage === "declined",
        }),
      );

      const outcome = await promise;

      if (!outcome.ok) throw new ChatGptAuthError(`${outcome.error}; run \`kerpeten auth login\` again`);

      const result = await this.finish(base, outcome.result, redirectUri, pkce.verifier, nonce, registering);

      signedIn.resolve(true);

      return result;
    } finally {
      signedIn.resolve(false);
      clearTimeout(timer);
      await server.stop();
    }
  }

  private async finish(
    base: AuthRecord,
    callback: CallbackResult,
    redirectUri: string,
    verifier: string,
    nonce: string,
    registering: boolean,
  ): Promise<SignInResult> {
    const clientId = base.client_id ?? callback.clientId;

    if (clientId === undefined) throw new ChatGptAuthError("the registration is incomplete: no client ID");

    if (registering) this.file.write({ ...base, client_id: clientId });

    const tokens = await this.oauth.exchange(callback.code, clientId, redirectUri, verifier);

    if (tokens.id_token === undefined) throw new ChatGptAuthError("the ChatGPT sign-in returned no ID token");

    const claims = await this.oauth.verifyIdToken({ token: tokens.id_token, clientId, nonce }, this.now());

    if (base.subject !== undefined && base.subject !== claims.sub) {
      throw new ChatGptAuthError(
        `a different ChatGPT account signed in than the one registered on this machine; to register another account, remove ${this.file.path} and run \`kerpeten auth login\``,
      );
    }

    const account: AuthRecord = {
      ...base,
      client_id: clientId,
      issuer: claims.iss,
      subject: claims.sub,
      ...(claims.email === undefined ? {} : { email: claims.email }),
    };

    const granted = { ...tokens, scope: tokens.scope ?? ChatGptOAuth.SCOPES };

    if (!scopesOf(granted.scope).includes(ChatGptOAuth.PLAN_SCOPE)) {
      const { tokens: _old, ...declined } = account;

      this.file.write({ ...declined, plan_usage: "declined" });

      throw new ChatGptAuthError(
        "the sign-in worked, but ChatGPT plan usage was not allowed for Kerpeten; run `kerpeten auth login` again and allow it",
      );
    }

    const record: AuthRecord = {
      ...account,
      plan_usage: "granted",
      tokens: storedTokens(granted, undefined, this.now()),
    };

    this.file.write(record);

    return { record, firstTime: base.plan_usage !== "granted" };
  }
}

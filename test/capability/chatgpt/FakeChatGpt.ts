import type { ChatGptEndpoints } from "../../../src/capability/chatgpt/types/chatgpt.ts";
import type { BrowseOptions, FakeOptions, PendingCode, ResponsesAnswer, SeenRequest } from "./types/fake.ts";

/**
 * A stand-in for the ChatGPT sign-in server and the Responses API on 127.0.0.1. Every token, code and key it
 * hands out is made up for the test run.
 */
export class FakeChatGpt {
  public static readonly ACCESS_PREFIX = "fake-access-token-";

  public static readonly REFRESH_PREFIX = "fake-refresh-token-";

  public static readonly CODE_PREFIX = "fake-auth-code-";

  public readonly seen: SeenRequest[] = [];

  public readonly options: FakeOptions = {
    issuedClientId: "oaiapp_fake_client",
    grantedScope: "chatgpt.tokens.use.direct email offline_access openid profile resource.invoke",
    nonceOverride: undefined,
    tamper: false,
    refreshMode: "rotate",
    email: "someone@example.invalid",
    subject: "fake-subject-1",
    revokeStatus: 200,
  };

  public readonly responses: ResponsesAnswer[] = [];
  private readonly codes = new Map<string, PendingCode>();
  private readonly server: ReturnType<typeof Bun.serve>;
  private keys: CryptoKeyPair | undefined;
  private issued = 0;

  public constructor() {
    this.server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (request) => this.handle(request),
    });
  }

  public static sse(events: readonly Record<string, unknown>[]): Response {
    const text = events.map(
      (event, index) =>
        `event: ${String(event.type)}\ndata: ${JSON.stringify({ sequence_number: index, ...event })}\n\n`,
    );

    return new Response(text.join(""), { headers: { "Content-Type": "text/event-stream" } });
  }

  public static text(text: string): Response {
    const item = { type: "message", id: "msg_1", role: "assistant" };

    return FakeChatGpt.sse([
      { type: "response.created", response: { id: "resp_1", created_at: 1, model: "plan-model" } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } },
      { type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: text },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: { ...item, status: "completed", content: [{ type: "output_text", text, annotations: [] }] },
      },
      {
        type: "response.completed",
        response: { incomplete_details: null, usage: { input_tokens: 10, output_tokens: 2 } },
      },
    ]);
  }

  public static limit(): Response {
    return FakeChatGpt.sse([
      { type: "response.created", response: { id: "resp_2", created_at: 1, model: "plan-model" } },
      {
        type: "response.failed",
        response: {
          error: { code: "subscription_sharing_usage_limit_exceeded", message: "usage limit" },
          incomplete_details: null,
        },
      },
    ]);
  }

  public get base(): string {
    return `http://127.0.0.1:${this.server.port}`;
  }

  public get endpoints(): ChatGptEndpoints {
    return {
      authorizeUrl: `${this.base}/api/accounts/authorize`,
      tokenUrl: `${this.base}/api/accounts/oauth/token`,
      discoveryUrl: `${this.base}/.well-known/openid-configuration`,
      issuer: this.base,
      apiBaseUrl: `${this.base}/v1`,
    };
  }

  public get issuedTokens(): readonly string[] {
    const all: string[] = [];

    for (let index = 1; index <= this.issued; index++) {
      all.push(`${FakeChatGpt.ACCESS_PREFIX}${index}`, `${FakeChatGpt.REFRESH_PREFIX}${index}`);
    }

    return all;
  }

  public stop(): void {
    this.server.stop(true);
  }

  public requests(path: string): readonly SeenRequest[] {
    return this.seen.filter((request) => request.path === path);
  }

  /** Acts as the user's browser: reads the authorization URL and calls the loopback callback with a code. */
  public async browse(authorizeUrl: string, options: BrowseOptions = {}): Promise<Response> {
    const url = new URL(authorizeUrl);
    const params = url.searchParams;
    const redirect = new URL(params.get("redirect_uri") ?? "");
    const state = options.state ?? params.get("state") ?? "";

    redirect.searchParams.set("state", state);

    if (options.error !== undefined) {
      redirect.searchParams.set("error", options.error);

      return fetch(redirect);
    }

    const requested = params.get("client_id") ?? "";
    const clientId = requested === "dynamic_agent_client" ? this.options.issuedClientId : requested;
    const code = `${FakeChatGpt.CODE_PREFIX}${this.codes.size + 1}`;

    this.codes.set(code, {
      nonce: params.get("nonce") ?? "",
      challenge: params.get("code_challenge") ?? "",
      clientId,
      redirectUri: redirect.origin + redirect.pathname,
    });

    redirect.searchParams.set("code", code);

    if (this.options.grantedScope !== undefined) redirect.searchParams.set("scope", this.options.grantedScope);

    const sentClient =
      options.clientId === undefined ? (requested === "dynamic_agent_client" ? clientId : null) : options.clientId;

    if (sentClient !== null) redirect.searchParams.set("client_id", sentClient);

    return fetch(redirect);
  }

  private async keyPair(): Promise<CryptoKeyPair> {
    this.keys ??= await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );

    return this.keys;
  }

  private async idToken(clientId: string, nonce: string): Promise<string> {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const header = encode({ alg: "RS256", kid: "fake-key", typ: "JWT" });

    const payload = encode({
      iss: this.base,
      aud: clientId,
      sub: this.options.subject,
      email: this.options.email,
      nonce: this.options.nonceOverride ?? nonce,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });

    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      (await this.keyPair()).privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    );

    const sent = this.options.tamper ? encode({ iss: this.base, aud: clientId, sub: "someone-else", nonce }) : payload;

    return `${header}.${sent}.${Buffer.from(signature).toString("base64url")}`;
  }

  private tokens(extra: Record<string, unknown>): Response {
    this.issued++;

    return Response.json({
      access_token: `${FakeChatGpt.ACCESS_PREFIX}${this.issued}`,
      refresh_token: `${FakeChatGpt.REFRESH_PREFIX}${this.issued}`,
      token_type: "Bearer",
      expires_in: 3600,
      scope: this.options.grantedScope,
      ...extra,
    });
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const text = request.method === "POST" ? await request.text() : "";
    const isForm = request.headers.get("content-type")?.includes("form") === true;
    const form = isForm ? Object.fromEntries(new URLSearchParams(text)) : {};
    const json = !isForm && text !== "" ? (JSON.parse(text) as Record<string, unknown>) : undefined;

    this.seen.push({
      method: request.method,
      path: url.pathname,
      headers: Object.fromEntries(request.headers.entries()),
      form,
      json,
    });

    switch (url.pathname) {
      case "/.well-known/openid-configuration":
        return Response.json({
          issuer: this.base,
          jwks_uri: `${this.base}/jwks`,
          revocation_endpoint: `${this.base}/api/accounts/oauth/revoke`,
        });

      case "/jwks":
        return Response.json({
          keys: [{ ...(await crypto.subtle.exportKey("jwk", (await this.keyPair()).publicKey)), kid: "fake-key" }],
        });

      case "/api/accounts/oauth/token":
        return this.token(form);

      case "/api/accounts/oauth/revoke":
        return new Response(null, { status: this.options.revokeStatus });

      case "/v1/models":
        return Response.json({
          models: [
            { slug: "plan-model", display_name: "Plan Model", visibility: "list" },
            { slug: "hidden-model", display_name: "Hidden", visibility: "hide" },
          ],
        });

      case "/v1/responses":
        return (this.responses.shift() ?? (() => Response.json({ error: { message: "unscripted" } }, { status: 500 })))(
          json ?? {},
        );

      default:
        return new Response("not found", { status: 404 });
    }
  }

  private async token(form: Record<string, string>): Promise<Response> {
    if (form.grant_type === "authorization_code") {
      const pending = this.codes.get(form.code ?? "");

      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.code_verifier)),
      );

      if (
        pending === undefined ||
        pending.clientId !== form.client_id ||
        pending.redirectUri !== form.redirect_uri ||
        pending.challenge !== Buffer.from(digest).toString("base64url") ||
        form.resource !== "https://api.openai.com/v1"
      ) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }

      this.codes.delete(form.code ?? "");

      return this.tokens({ id_token: await this.idToken(pending.clientId, pending.nonce) });
    }

    if (form.grant_type === "refresh_token") {
      if (this.options.refreshMode === "down") return new Response("unavailable", { status: 503 });

      if (this.options.refreshMode === "invalid_grant")
        return Response.json({ error: "invalid_grant" }, { status: 400 });

      return this.tokens({});
    }

    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }
}

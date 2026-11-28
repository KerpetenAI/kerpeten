import type { webcrypto } from "node:crypto";
import { Inject } from "@asenajs/ioc";
import { Capability, CapabilityBase } from "@kerpetensh/harness-kit";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { ChatGptAuthError } from "./ChatGptAuthError.ts";
import { decodeBase64Url, jsonPart } from "./chatgpt-utils.ts";
import {
  discoverySchema,
  idTokenClaimsSchema,
  jwksSchema,
  jwtHeaderSchema,
  oauthErrorSchema,
  tokenResponseSchema,
} from "./schemas/chatgpt-schema.ts";
import type {
  AuthorizeRequest,
  ChatGptEndpoints,
  Discovery,
  IdTokenCheck,
  IdTokenClaims,
  Jwk,
  JwsAlgorithm,
  RefreshOutcome,
  SignedToken,
  TokenResponse,
} from "./types/chatgpt.ts";

@Capability({
  name: "chatgpt-oauth",
  description:
    "Talks to the ChatGPT sign-in server at auth.openai.com: exchanges the authorization code, refreshes and revokes the tokens, and checks the ID token against the server's published keys.",
})
export class ChatGptOAuth extends CapabilityBase {
  public static readonly PRODUCTION: ChatGptEndpoints = {
    authorizeUrl: "https://auth.openai.com/api/accounts/authorize",
    tokenUrl: "https://auth.openai.com/api/accounts/oauth/token",
    discoveryUrl: "https://auth.openai.com/.well-known/openid-configuration",
    issuer: "https://auth.openai.com",
    apiBaseUrl: "https://api.openai.com/v1",
  };

  public static readonly APP_NAME = "Kerpeten";

  public static readonly REGISTRATION_CLIENT_ID = "dynamic_agent_client";

  public static readonly PLAN_SCOPE = "chatgpt.tokens.use.direct";

  public static readonly SCOPES = `openid profile email offline_access resource.invoke ${ChatGptOAuth.PLAN_SCOPE}`;

  public static readonly RESOURCE = "https://api.openai.com/v1";

  private static readonly UNUSABLE_REFRESH: ReadonlySet<string> = new Set([
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
    "invalid_client",
  ]);

  private static readonly TIMEOUT_MS = 30_000;

  private static readonly CLOCK_SKEW_S = 30;

  private static readonly ALGORITHMS: Readonly<Record<string, JwsAlgorithm>> = {
    RS256: {
      kty: "RSA",
      key: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      verify: { name: "RSASSA-PKCS1-v1_5" },
    },
    RS384: {
      kty: "RSA",
      key: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-384" },
      verify: { name: "RSASSA-PKCS1-v1_5" },
    },
    RS512: {
      kty: "RSA",
      key: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
      verify: { name: "RSASSA-PKCS1-v1_5" },
    },
    ES256: { kty: "EC", key: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" } },
    ES384: { kty: "EC", key: { name: "ECDSA", namedCurve: "P-384" }, verify: { name: "ECDSA", hash: "SHA-384" } },
  };

  @Inject(Names.CHATGPT_ENDPOINTS)
  public readonly endpoints!: Instances[Names.CHATGPT_ENDPOINTS];

  private discovered: Promise<Discovery> | undefined;

  private static async oauthError(response: Response): Promise<string | undefined> {
    try {
      const parsed = oauthErrorSchema.safeParse(await response.json());

      return parsed.success ? parsed.data.error : undefined;
    } catch {
      return undefined;
    }
  }

  private static async verifySignature(token: SignedToken, key: Jwk): Promise<boolean> {
    const algorithm = ChatGptOAuth.ALGORITHMS[token.alg];

    if (algorithm === undefined || key.kty !== algorithm.kty) return false;

    const { kid: _kid, alg: _alg, ...material } = key;

    const jwk = Object.fromEntries(
      Object.entries(material).filter(([, value]) => value !== undefined),
    ) as webcrypto.JsonWebKey;

    try {
      const imported = await crypto.subtle.importKey("jwk", jwk, algorithm.key, false, ["verify"]);

      return await crypto.subtle.verify(
        algorithm.verify,
        imported,
        decodeBase64Url(token.signature),
        new TextEncoder().encode(token.signed),
      );
    } catch {
      return false;
    }
  }

  private static invalidIdToken(why: string): ChatGptAuthError {
    return new ChatGptAuthError(`the ChatGPT ID token is not valid (${why}); sign-in stopped`);
  }

  public authorizeUrl(request: AuthorizeRequest): string {
    const params = new URLSearchParams({ client_id: request.clientId ?? ChatGptOAuth.REGISTRATION_CLIENT_ID });

    if (request.clientId === undefined) params.set("agent_name_hint", ChatGptOAuth.APP_NAME);

    params.set("ext_agent_host_id", request.hostId);

    if (request.clientId !== undefined && request.loginHint !== undefined) params.set("login_hint", request.loginHint);

    params.set("response_type", "code");
    params.set("redirect_uri", request.redirectUri);
    params.set("scope", ChatGptOAuth.SCOPES);
    params.set("resource", ChatGptOAuth.RESOURCE);
    params.set("state", request.state);
    params.set("nonce", request.nonce);
    params.set("code_challenge_method", "S256");
    params.set("code_challenge", request.challenge);

    if (request.consent) params.set("prompt", "consent");

    return `${this.endpoints.authorizeUrl}?${params.toString()}`;
  }

  public async exchange(code: string, clientId: string, redirectUri: string, verifier: string): Promise<TokenResponse> {
    const response = await this.post(this.endpoints.tokenUrl, {
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: ChatGptOAuth.RESOURCE,
    });

    if (!response.ok) {
      const error = await ChatGptOAuth.oauthError(response);

      throw new ChatGptAuthError(
        `the ChatGPT sign-in server did not accept the authorization code (HTTP ${response.status}${error === undefined ? "" : `, ${error}`}); run \`kerpeten auth login\` again`,
      );
    }

    return this.tokens(response);
  }

  public async refresh(clientId: string, refreshToken: string): Promise<RefreshOutcome> {
    let response: Response;

    try {
      response = await this.post(this.endpoints.tokenUrl, {
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: refreshToken,
        resource: ChatGptOAuth.RESOURCE,
      });
    } catch {
      return { ok: false, unusable: false, reason: "the ChatGPT sign-in server could not be reached" };
    }

    if (response.ok) return { ok: true, tokens: await this.tokens(response) };

    const error = await ChatGptOAuth.oauthError(response);
    const reason = `HTTP ${response.status}${error === undefined ? "" : `, ${error}`}`;

    return { ok: false, unusable: error !== undefined && ChatGptOAuth.UNUSABLE_REFRESH.has(error), reason };
  }

  /** Revokes the refresh token; true when the server confirmed it with HTTP 200. */
  public async revoke(clientId: string, refreshToken: string): Promise<boolean> {
    try {
      const endpoint = (await this.discovery()).revocation_endpoint;

      if (endpoint === undefined) return false;

      const response = await this.post(endpoint, {
        token: refreshToken,
        token_type_hint: "refresh_token",
        client_id: clientId,
      });

      return response.status === 200;
    } catch {
      return false;
    }
  }

  public async verifyIdToken(check: IdTokenCheck, now: number): Promise<IdTokenClaims> {
    const parts = check.token.split(".");
    const invalid = ChatGptOAuth.invalidIdToken;

    if (parts.length !== 3) throw invalid("not a JWT");

    const [header, payload, signature] = parts as [string, string, string];
    const parsedHeader = jwtHeaderSchema.safeParse(this.decoded(header));

    if (!parsedHeader.success || ChatGptOAuth.ALGORITHMS[parsedHeader.data.alg] === undefined) {
      throw invalid("not signed with a supported algorithm");
    }

    const discovery = await this.discovery();

    if (discovery.issuer !== this.endpoints.issuer) throw invalid("the discovery document names another issuer");

    const keys = await this.keys(discovery.jwks_uri);
    const kid = parsedHeader.data.kid;
    const candidates = keys.filter((key) => kid === undefined || key.kid === kid);
    const signed: SignedToken = { alg: parsedHeader.data.alg, signed: `${header}.${payload}`, signature };
    let verified = false;

    for (const key of candidates) {
      if (await ChatGptOAuth.verifySignature(signed, key)) {
        verified = true;
        break;
      }
    }

    if (!verified) throw invalid("the signature does not match the published keys");

    const parsedClaims = idTokenClaimsSchema.safeParse(this.decoded(payload));

    if (!parsedClaims.success) throw invalid("missing claims");

    const claims = parsedClaims.data;
    const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;

    if (claims.iss !== discovery.issuer) throw invalid("wrong issuer");
    if (!audiences.includes(check.clientId)) throw invalid("wrong audience");
    if (claims.exp + ChatGptOAuth.CLOCK_SKEW_S < now / 1000) throw invalid("expired");
    if (claims.iat - ChatGptOAuth.CLOCK_SKEW_S > now / 1000) throw invalid("issued in the future");
    if (claims.nonce !== check.nonce) throw invalid("the nonce does not match this sign-in");

    return claims;
  }

  private decoded(part: string): unknown {
    try {
      return jsonPart(part);
    } catch {
      return undefined;
    }
  }

  private async discovery(): Promise<Discovery> {
    this.discovered ??= this.get(this.endpoints.discoveryUrl).then((body) => {
      const parsed = discoverySchema.safeParse(body);

      if (!parsed.success) throw new ChatGptAuthError("the ChatGPT sign-in server sent an unreadable configuration");

      return parsed.data;
    });

    return this.discovered;
  }

  private async keys(url: string): Promise<readonly Jwk[]> {
    const parsed = jwksSchema.safeParse(await this.get(url));

    if (!parsed.success) throw new ChatGptAuthError("the ChatGPT sign-in server sent unreadable signing keys");

    return parsed.data.keys;
  }

  private async get(url: string): Promise<unknown> {
    const response = await fetch(url, { signal: AbortSignal.timeout(ChatGptOAuth.TIMEOUT_MS) });

    if (!response.ok) throw new ChatGptAuthError(`the ChatGPT sign-in server answered HTTP ${response.status}`);

    return response.json();
  }

  private post(url: string, form: Readonly<Record<string, string>>): Promise<Response> {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(ChatGptOAuth.TIMEOUT_MS),
    });
  }

  private async tokens(response: Response): Promise<TokenResponse> {
    const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => undefined));

    if (!parsed.success) throw new ChatGptAuthError("the ChatGPT sign-in server sent an unreadable token response");

    return parsed.data;
  }
}

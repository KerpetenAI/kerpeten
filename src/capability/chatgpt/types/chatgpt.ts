import type { webcrypto } from "node:crypto";
import type { z } from "zod";
import type {
  authRecordSchema,
  discoverySchema,
  idTokenClaimsSchema,
  storedTokensSchema,
  tokenResponseSchema,
} from "../schemas/chatgpt-schema.ts";

export type AuthRecord = z.infer<typeof authRecordSchema>;

export type StoredTokens = z.infer<typeof storedTokensSchema>;

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export type Discovery = z.infer<typeof discoverySchema>;

export type IdTokenClaims = z.infer<typeof idTokenClaimsSchema>;

/** Where the sign-in talks to; tests point these at a fake server. */
export interface ChatGptEndpoints {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly discoveryUrl: string;
  readonly issuer: string;
  readonly apiBaseUrl: string;
}

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

export interface AuthorizeRequest {
  readonly clientId: string | undefined;
  readonly hostId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly nonce: string;
  readonly challenge: string;
  readonly loginHint: string | undefined;
  readonly consent: boolean;
}

export interface CallbackResult {
  readonly code: string;
  readonly clientId: string | undefined;
}

export type CallbackOutcome =
  | { readonly ok: true; readonly result: CallbackResult }
  | { readonly ok: false; readonly error: string };

export interface SignInOptions {
  readonly show: (line: string) => void;
  readonly timeoutMs?: number;
}

export interface SignInResult {
  readonly record: AuthRecord;
  readonly firstTime: boolean;
}

export type RefreshOutcome =
  | { readonly ok: true; readonly tokens: TokenResponse }
  | { readonly ok: false; readonly unusable: boolean; readonly reason: string };

export interface IdTokenCheck {
  readonly token: string;
  readonly clientId: string;
  readonly nonce: string;
}

export interface Jwk {
  readonly kty: string;
  readonly kid?: string | undefined;
  readonly alg?: string | undefined;
  readonly n?: string | undefined;
  readonly e?: string | undefined;
  readonly crv?: string | undefined;
  readonly x?: string | undefined;
  readonly y?: string | undefined;
}

export interface JwsAlgorithm {
  readonly kty: string;
  readonly key: webcrypto.RsaHashedImportParams | webcrypto.EcKeyImportParams;
  readonly verify: webcrypto.AlgorithmIdentifier | webcrypto.EcdsaParams;
}

export interface SignedToken {
  readonly alg: string;
  readonly signed: string;
  readonly signature: string;
}

export interface UsableSignIn {
  readonly record: AuthRecord;
  readonly tokens: StoredTokens;
  readonly clientId: string;
}

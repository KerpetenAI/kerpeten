import type { ChatGptAuthFile } from "../../../../src/capability/chatgpt/ChatGptAuthFile.ts";
import type { ChatGptOAuth } from "../../../../src/capability/chatgpt/ChatGptOAuth.ts";
import type { ChatGptPlan } from "../../../../src/capability/chatgpt/ChatGptPlan.ts";
import type { ChatGptSignIn } from "../../../../src/capability/chatgpt/ChatGptSignIn.ts";
import type { ChatGptTokens } from "../../../../src/capability/chatgpt/ChatGptTokens.ts";

export type RefreshMode = "rotate" | "invalid_grant" | "down";

export interface FakeOptions {
  issuedClientId: string;
  grantedScope: string | undefined;
  nonceOverride: string | undefined;
  tamper: boolean;
  refreshMode: RefreshMode;
  email: string;
  subject: string;
  revokeStatus: number;
}

export interface SeenRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly form: Record<string, string>;
  readonly json: Record<string, unknown> | undefined;
}

export interface PendingCode {
  readonly nonce: string;
  readonly challenge: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

export interface BrowseOptions {
  readonly state?: string;
  readonly clientId?: string | null;
  readonly error?: string;
}

export type ResponsesAnswer = (body: Record<string, unknown>) => Response;

export interface ChatGptParts {
  readonly file: ChatGptAuthFile;
  readonly oauth: ChatGptOAuth;
  readonly tokens: ChatGptTokens;
  readonly signIn: ChatGptSignIn;
  readonly plan: ChatGptPlan;
}

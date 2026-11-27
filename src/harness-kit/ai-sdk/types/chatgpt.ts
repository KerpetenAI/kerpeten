import type { LanguageModelMiddleware } from "ai";

/** Returns the bearer token for the next request; it refreshes the token when needed and throws when there is none. */
export type BearerToken = () => Promise<string>;

export interface ToolNamespace {
  readonly name: string;
  readonly description: string;
}

export interface ChatGptAdapterOptions {
  readonly token: BearerToken;
  readonly baseUrl?: string;
  readonly namespace?: ToolNamespace;
  readonly modelListTimeoutMs?: number;
}

/**
 * Why ChatGPT plan usage stopped a request: `usage_limit` and `usage_unavailable` come from the plan,
 * `unauthorized` from a token the API did not accept and `refused` from any other plan usage refusal.
 */
export type ChatGptErrorKind = "usage_limit" | "usage_unavailable" | "unauthorized" | "refused";

export interface ChatGptErrorInit {
  readonly kind: ChatGptErrorKind;
  readonly code: string | undefined;
  readonly status: number | undefined;
  readonly detail: string;
}

export interface ChatGptModel {
  readonly slug: string;
  readonly displayName: string;
}

export interface ErrorFacts {
  readonly code: string | undefined;
  readonly status: number | undefined;
  readonly detail: string;
}

export type WrapGenerate = NonNullable<LanguageModelMiddleware["wrapGenerate"]>;

export type GenerateResult = Awaited<ReturnType<WrapGenerate>>;

export type StreamResult = Awaited<ReturnType<Parameters<WrapGenerate>[0]["doStream"]>>;

export type StreamPart = StreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

export type GeneratedContent = GenerateResult["content"][number];

export type CallParams = Parameters<WrapGenerate>[0]["params"];

export type TextSlot = Extract<GeneratedContent, { type: "text" | "reasoning" }>;

export type FinishPart = Extract<StreamPart, { type: "finish" }>;

export type EndPart = Extract<StreamPart, { type: "text-end" | "reasoning-end" }>;

export interface ModelListBody {
  readonly models?: unknown;
}

export interface IncompleteEvent {
  readonly response?: { readonly incomplete_details?: { readonly reason?: unknown } };
}

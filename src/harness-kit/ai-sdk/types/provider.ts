import type { JSONValue } from "ai";
import type { ProviderAdapter } from "../ProviderAdapter.ts";

export type Provider = "anthropic" | "openai" | "openrouter" | "chatgpt";

/** The providers that take an API key. */
export type KeyProvider = Exclude<Provider, "chatgpt">;

export type CacheMarker = Record<string, Record<string, JSONValue>>;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type EffortOptions = Record<string, Record<string, JSONValue>>;

export interface ModelSettings {
  readonly provider: Provider;
  readonly model: string;
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly zdr: boolean;
  readonly effort?: Effort;
  readonly maxOutputTokens?: number;
}

export type KeyedProviderAdapter = ProviderAdapter & { readonly keyEnv: string };

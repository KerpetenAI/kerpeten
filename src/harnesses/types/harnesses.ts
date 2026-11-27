import type { Model, Usage } from "../../api/types/api.generated.ts";
import type { HarnessOptions, LlmAdapter } from "../../harness-kit/index.ts";

export type PromptRole = "reviewer" | "judge";

export interface PromptVariables {
  readonly comment_language: string;
}

/** The provider of a run: one of the API's providers, or `chatgpt`, which the API does not know yet. */
export type RunProvider = Model["provider"] | "chatgpt";

export type UsageEntry = Readonly<Omit<Usage, "provider"> & { readonly provider: RunProvider }>;

export type ProviderLlm = LlmAdapter & { readonly provider: RunProvider };

export interface Deadlines {
  readonly stepDeadline: number;
  readonly finalizeDeadline: number;
}

export interface RoleHarnessOptions extends HarnessOptions {
  readonly llm: ProviderLlm;
  readonly nonce?: string;
}

import type { ModelConfig } from "../../../capability/config/types/config.ts";
import type { ChatGptModel } from "../../../harness-kit/ai-sdk/index.ts";

export type InitProvider = ModelConfig["provider"];

/** One entry of the provider list `kerpeten init` shows. */
export interface ProviderChoice {
  readonly provider: InitProvider;
  readonly label: string;
}

export interface InitModel {
  readonly provider: InitProvider;
  readonly model: string;
}

/** What the user answered: the two models and the language of the review comments. */
export interface InitAnswers {
  readonly reviewer: InitModel;
  readonly judge: InitModel;
  readonly language: string;
}

/** An answer turned into its value, or the short reason it is asked again. */
export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** The models of the signed-in ChatGPT plan, or the reason they cannot be listed. */
export type PlanModelList =
  | { readonly ok: true; readonly models: readonly ChatGptModel[] }
  | { readonly ok: false; readonly reason: string };

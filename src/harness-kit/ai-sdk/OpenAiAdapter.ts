import {
  createOpenAI,
  type OpenAILanguageModelChatOptions,
  type OpenAILanguageModelResponsesOptions,
} from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { ProviderAdapter } from "./ProviderAdapter.ts";
import type { Effort, EffortOptions, ModelSettings } from "./types/provider.ts";

export class OpenAiAdapter extends ProviderAdapter {
  public override readonly provider = "openai";
  public override readonly keyEnv = "OPENAI_API_KEY";

  public constructor(defaultBaseUrl = "https://api.openai.com/v1") {
    super(defaultBaseUrl);
  }

  public override effortOptions(effort: Effort): EffortOptions {
    return {
      openai: { reasoningEffort: effort, reasoningSummary: null } satisfies OpenAILanguageModelChatOptions &
        OpenAILanguageModelResponsesOptions,
    };
  }

  protected override create(settings: ModelSettings, baseURL: string): Exclude<LanguageModel, string> {
    const openai = createOpenAI({ apiKey: settings.apiKey, baseURL });

    return settings.baseUrl === undefined ? openai(settings.model) : openai.chat(settings.model);
  }
}

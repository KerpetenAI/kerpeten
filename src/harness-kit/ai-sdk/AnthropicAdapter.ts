import { type AnthropicLanguageModelOptions, createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { ProviderAdapter } from "./ProviderAdapter.ts";
import type { CacheMarker, Effort, EffortOptions, ModelSettings } from "./types/provider.ts";

export class AnthropicAdapter extends ProviderAdapter {
  public override readonly provider = "anthropic";
  public override readonly keyEnv = "ANTHROPIC_API_KEY";

  public constructor(defaultBaseUrl = "https://api.anthropic.com/v1") {
    super(defaultBaseUrl);
  }

  public override cacheMarker(_settings: ModelSettings): CacheMarker {
    return { anthropic: { cacheControl: { type: "ephemeral" } } };
  }

  public override effortOptions(effort: Effort): EffortOptions {
    return { anthropic: { effort } satisfies AnthropicLanguageModelOptions };
  }

  protected override create(settings: ModelSettings, baseURL: string): Exclude<LanguageModel, string> {
    return createAnthropic({ apiKey: settings.apiKey, baseURL })(settings.model);
  }
}

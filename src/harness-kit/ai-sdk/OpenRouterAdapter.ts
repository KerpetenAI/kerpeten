import { createOpenRouter, type OpenRouterProviderOptions } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { ProviderAdapter } from "./ProviderAdapter.ts";
import type { CacheMarker, Effort, EffortOptions, ModelSettings } from "./types/provider.ts";

export class OpenRouterAdapter extends ProviderAdapter {
  public override readonly provider = "openrouter";
  public override readonly keyEnv = "OPENROUTER_API_KEY";

  public constructor(defaultBaseUrl = "https://openrouter.ai/api/v1") {
    super(defaultBaseUrl);
  }

  public override cacheMarker(settings: ModelSettings): CacheMarker | undefined {
    return settings.baseUrl === undefined ? { openrouter: { cacheControl: { type: "ephemeral" } } } : undefined;
  }

  public override effortOptions(effort: Effort): EffortOptions {
    if (effort === "max") throw new Error("OpenRouter has no `max` effort; the highest is `xhigh`");

    return { openrouter: { reasoning: { effort } } satisfies OpenRouterProviderOptions };
  }

  protected override create(settings: ModelSettings, baseURL: string): Exclude<LanguageModel, string> {
    const openrouter = createOpenRouter({ apiKey: settings.apiKey, baseURL });

    return settings.baseUrl === undefined && settings.zdr
      ? openrouter.chat(settings.model, { provider: { zdr: true } })
      : openrouter.chat(settings.model);
  }
}

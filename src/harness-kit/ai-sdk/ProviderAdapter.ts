import type { LanguageModel } from "ai";
import type { CacheMarker, Effort, EffortOptions, ModelSettings, Provider } from "./types/provider.ts";

export abstract class ProviderAdapter {
  public abstract readonly provider: Provider;
  public abstract readonly keyEnv: string | undefined;
  public readonly defaultBaseUrl: string;

  public constructor(defaultBaseUrl: string) {
    this.defaultBaseUrl = defaultBaseUrl;
  }

  public languageModel(settings: ModelSettings): Exclude<LanguageModel, string> {
    if (this.keyEnv !== undefined && settings.apiKey === "") throw new Error("the API key is empty");
    if (settings.model === "") throw new Error("the model name is empty");

    return this.create(settings, settings.baseUrl ?? this.defaultBaseUrl);
  }

  public cacheMarker(_settings: ModelSettings): CacheMarker | undefined {
    return undefined;
  }

  public abstract effortOptions(effort: Effort): EffortOptions;

  protected abstract create(settings: ModelSettings, baseURL: string): Exclude<LanguageModel, string>;
}

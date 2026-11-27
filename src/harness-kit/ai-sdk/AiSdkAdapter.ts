import type { LlmAdapter, LlmSession, SessionInput } from "../types/llm.ts";
import { AiSdkSession } from "./AiSdkSession.ts";
import { AnthropicAdapter } from "./AnthropicAdapter.ts";
import { OpenAiAdapter } from "./OpenAiAdapter.ts";
import { OpenRouterAdapter } from "./OpenRouterAdapter.ts";
import type { ProviderAdapter } from "./ProviderAdapter.ts";
import type { AiSdkAdapterOptions, AiSdkSettings, SessionOptions } from "./types/ai-sdk.ts";
import type { KeyedProviderAdapter, KeyProvider, Provider } from "./types/provider.ts";

export class AiSdkAdapter implements LlmAdapter {
  public static readonly ADAPTERS: Readonly<Record<KeyProvider, KeyedProviderAdapter>> = {
    anthropic: new AnthropicAdapter(),
    openai: new OpenAiAdapter(),
    openrouter: new OpenRouterAdapter(),
  };

  private static readonly DEFAULT_MAX_RETRIES = 2;

  public readonly provider: Provider;
  public readonly model: string;
  private readonly session: SessionOptions;

  public constructor(options: AiSdkAdapterOptions) {
    const { maxOutputTokens } = options;

    if (maxOutputTokens !== undefined && (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)) {
      throw new Error("maxOutputTokens must be a positive whole number");
    }

    this.provider = options.provider;
    this.model = options.modelId;

    this.session = {
      model: options.model,
      maxOutputTokens,
      cache: options.cache,
      effort: options.effort,
      maxRetries: options.maxRetries ?? AiSdkAdapter.DEFAULT_MAX_RETRIES,
    };
  }

  public static fromSettings(
    settings: AiSdkSettings,
    adapter: ProviderAdapter = AiSdkAdapter.adapterFor(settings.provider),
  ): AiSdkAdapter {
    const model = adapter.languageModel(settings);
    const cache = adapter.cacheMarker(settings);

    return new AiSdkAdapter({
      model,
      provider: settings.provider,
      modelId: settings.model,
      ...(settings.maxOutputTokens === undefined ? {} : { maxOutputTokens: settings.maxOutputTokens }),
      ...(cache === undefined ? {} : { cache }),
      ...(settings.effort === undefined ? {} : { effort: adapter.effortOptions(settings.effort) }),
      ...(settings.maxRetries === undefined ? {} : { maxRetries: settings.maxRetries }),
    });
  }

  private static adapterFor(provider: Provider): ProviderAdapter {
    if (provider === "chatgpt") throw new Error("the chatgpt provider needs a ChatGptAdapter with a token source");

    return AiSdkAdapter.ADAPTERS[provider];
  }

  public start(input: SessionInput): LlmSession {
    return new AiSdkSession(this.session, input);
  }
}

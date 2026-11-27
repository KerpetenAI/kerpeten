import { type AnthropicLanguageModelOptions, createAnthropic } from "@ai-sdk/anthropic";
import { type LanguageModel, wrapLanguageModel } from "ai";
import { ProviderAdapter } from "./ProviderAdapter.ts";
import type { CacheMarker, Effort, EffortOptions, ModelSettings } from "./types/provider.ts";

/**
 * The Anthropic Messages API. The API needs an output token limit on every request: when the caller gives none, the
 * SDK sends the limit of the model, and for a model it does not know it would send 4096. So that an answer is never
 * cut at a limit nobody chose, a model behind another base URL is refused without a limit before any request, and a
 * request the SDK had to guess the limit for ends as an error.
 */
export class AnthropicAdapter extends ProviderAdapter {
  public override readonly provider = "anthropic";
  public override readonly keyEnv = "ANTHROPIC_API_KEY";

  public constructor(defaultBaseUrl = "https://api.anthropic.com/v1") {
    super(defaultBaseUrl);
  }

  private static withoutEndSlash(url: string): string {
    return url.replace(/\/+$/, "");
  }

  public override cacheMarker(_settings: ModelSettings): CacheMarker {
    return { anthropic: { cacheControl: { type: "ephemeral" } } };
  }

  public override effortOptions(effort: Effort): EffortOptions {
    return { anthropic: { effort } satisfies AnthropicLanguageModelOptions };
  }

  public override languageModel(settings: ModelSettings): Exclude<LanguageModel, string> {
    const elsewhere =
      settings.baseUrl !== undefined &&
      AnthropicAdapter.withoutEndSlash(settings.baseUrl) !== AnthropicAdapter.withoutEndSlash(this.defaultBaseUrl);

    if (elsewhere && settings.maxOutputTokens === undefined) {
      throw new Error(
        `the model ${settings.model} is behind another base URL, so its output token limit is not known; set max_output_tokens for it`,
      );
    }

    return super.languageModel(settings);
  }

  protected override create(settings: ModelSettings, baseURL: string): Exclude<LanguageModel, string> {
    return wrapLanguageModel({
      model: createAnthropic({ apiKey: settings.apiKey, baseURL })(settings.model),
      middleware: {
        wrapGenerate: async ({ doGenerate, params }) => {
          const result = await doGenerate();

          const guessed =
            params.maxOutputTokens === undefined &&
            result.warnings.some(
              (warning) => warning.type === "compatibility" && warning.feature === "maxOutputTokens",
            );

          if (guessed) {
            throw new Error(
              `the output token limit of the model ${settings.model} is not known; set max_output_tokens for it`,
            );
          }

          return result;
        },
      },
    });
  }
}

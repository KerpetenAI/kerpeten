import { Inject, Service } from "@asenajs/ioc";
import { UsageError } from "@kerpetensh/harness-kit";
import { AiSdkAdapter } from "@kerpetensh/harness-kit/ai-sdk";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { ConfigLoader } from "../../capability/config/ConfigLoader.ts";
import type { KeyModelConfig, ModelConfig } from "../../capability/config/types/config.ts";
import type { PromptRole } from "../../harnesses/types/harnesses.ts";

/** Finds the API key of a model in the environment, and refuses to send it to an endpoint the user did not trust. */
@Service("kerpeten:model-keys")
export class ModelKeys {
  public static readonly TRUSTED_ENDPOINTS_ENV = "KERPETEN_TRUSTED_ENDPOINTS";

  @Inject(Names.ENV)
  private readonly env!: Instances[Names.ENV];

  public static keyEnvName(model: KeyModelConfig): string {
    return model.api_key_env ?? AiSdkAdapter.ADAPTERS[model.provider].keyEnv;
  }

  public untrustedEndpoint(model: KeyModelConfig): string | undefined {
    const keyName = ModelKeys.keyEnvName(model);

    if (model.base_url === undefined && keyName === AiSdkAdapter.ADAPTERS[model.provider].keyEnv) return undefined;

    const entry = `${keyName}=${model.base_url ?? model.provider}`;
    const trusted = (this.env[ModelKeys.TRUSTED_ENDPOINTS_ENV] ?? "").split(/[\s,]+/);

    return trusted.includes(entry) ? undefined : entry;
  }

  /** The API key of the model, or undefined for a model that signs in with ChatGPT; throws a `UsageError` otherwise. */
  public checkedKey(role: PromptRole, model: ModelConfig): string | undefined {
    if (model.provider === "chatgpt") return undefined;

    const untrusted = this.untrustedEndpoint(model);

    if (untrusted !== undefined) {
      throw new UsageError(
        `${ConfigLoader.CONFIG_FILE} sends the ${role} key to an endpoint or under a key name that is not the provider default; if you trust it, add "${untrusted}" to ${ModelKeys.TRUSTED_ENDPOINTS_ENV}`,
      );
    }

    const keyName = ModelKeys.keyEnvName(model);
    const apiKey = this.env[keyName];

    if (apiKey === undefined || apiKey.trim() === "")
      throw new UsageError(`the ${role} API key is missing; set ${keyName}`);

    return apiKey;
  }
}

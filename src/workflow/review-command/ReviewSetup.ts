import { join } from "node:path";
import { Inject, Service } from "@asenajs/ioc";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { ChatGptPlan } from "../../capability/chatgpt/ChatGptPlan.ts";
import { ChatGptTokens } from "../../capability/chatgpt/ChatGptTokens.ts";
import { ConfigLoader } from "../../capability/config/ConfigLoader.ts";
import type { ModelConfig } from "../../capability/config/types/config.ts";
import { GitRoot } from "../../capability/git/GitRoot.ts";
import { UsageError } from "../../harness-kit/index.ts";
import type { PromptRole, ProviderLlm } from "../../harnesses/types/harnesses.ts";
import { errorMessage } from "../../text/text-utils.ts";
import { ModelKeys } from "./ModelKeys.ts";
import type { ReviewPreparation } from "./types/review-command.ts";

/**
 * Gets a review ready before any model is called: finds the repository around the working directory, loads its
 * `.kerpeten.yml`, checks the keys of both models, loads the ChatGPT sign-in when a model uses it, and builds the two
 * model clients. Every problem the user can fix comes back as a problem line, not as an error.
 */
@Service("kerpeten:review-setup")
export class ReviewSetup {
  @Inject(Names.ENV)
  private readonly env!: Instances[Names.ENV];

  @Inject(GitRoot)
  private readonly gitRoot!: GitRoot;

  @Inject(Names.MODEL_CLIENTS)
  private readonly createClient!: Instances[Names.MODEL_CLIENTS];

  @Inject(ConfigLoader)
  private readonly configLoader!: ConfigLoader;

  @Inject(ModelKeys)
  private readonly keys!: ModelKeys;

  @Inject(ChatGptTokens)
  private readonly tokens!: ChatGptTokens;

  @Inject(ChatGptPlan)
  private readonly chatgpt!: ChatGptPlan;

  public async prepare(): Promise<ReviewPreparation> {
    let repo: string;

    try {
      repo = await this.gitRoot.root();
    } catch (error) {
      return { ok: false, problems: [errorMessage(error)] };
    }

    const loaded = this.configLoader.load(join(repo, ConfigLoader.CONFIG_FILE));

    if (!loaded.ok) return { ok: false, problems: loaded.errors.map((problem) => `invalid configuration: ${problem}`) };

    const { reviewer, judge } = loaded.config.models;
    const zdr = loaded.config.openrouter.zdr;

    try {
      const reviewerKey = this.keys.checkedKey("reviewer", reviewer);
      const judgeKey = this.keys.checkedKey("judge", judge);
      const plan = await this.signedInPlan([reviewer, judge]);

      return {
        ok: true,
        review: {
          repo,
          config: loaded.config,
          configHash: loaded.hash,
          reviewerClient: this.client("reviewer", reviewer, reviewerKey, zdr, plan),
          judgeClient: this.client("judge", judge, judgeKey, zdr, plan),
          plan,
          pathEnv: this.env.PATH ?? "/usr/bin:/bin",
        },
      };
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;

      return { ok: false, problems: [error.message] };
    }
  }

  private async signedInPlan(models: readonly ModelConfig[]): Promise<ChatGptPlan | undefined> {
    if (!models.some((model) => model.provider === "chatgpt")) return undefined;

    try {
      await this.tokens.accessToken();

      return this.chatgpt;
    } catch (error) {
      throw new UsageError(ChatGptPlan.failureMessage(error));
    }
  }

  private client(
    role: PromptRole,
    model: ModelConfig,
    apiKey: string | undefined,
    zdr: boolean,
    plan: ChatGptPlan | undefined,
  ): ProviderLlm {
    try {
      if (model.provider === "chatgpt") {
        if (plan === undefined) throw new Error("the ChatGPT sign-in is not loaded");

        return this.createClient(
          {
            provider: model.provider,
            model: model.model,
            apiKey: "",
            zdr,
            ...(model.effort === undefined ? {} : { effort: model.effort }),
          },
          plan.adapter,
        );
      }

      return this.createClient({
        provider: model.provider,
        model: model.model,
        apiKey: apiKey ?? "",
        ...(model.base_url === undefined ? {} : { baseUrl: model.base_url }),
        zdr,
        ...(model.max_output_tokens === undefined ? {} : { maxOutputTokens: model.max_output_tokens }),
        ...(model.effort === undefined ? {} : { effort: model.effort }),
      });
    } catch (error) {
      throw new UsageError(`cannot set up the ${role} model: ${errorMessage(error)}`);
    }
  }
}

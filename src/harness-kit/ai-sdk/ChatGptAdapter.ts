import {
  createOpenAI,
  type OpenAILanguageModelResponsesOptions,
  type OpenAIResponsesProviderOptions,
} from "@ai-sdk/openai";
import { type LanguageModel, wrapLanguageModel } from "ai";
import { ChatGptError } from "./ChatGptError.ts";
import { ChatGptStream } from "./ChatGptStream.ts";
import { ProviderAdapter } from "./ProviderAdapter.ts";
import type {
  BearerToken,
  CallParams,
  ChatGptAdapterOptions,
  ChatGptModel,
  GenerateResult,
  ModelListBody,
  StreamResult,
  ToolNamespace,
} from "./types/chatgpt.ts";
import type { Effort, EffortOptions, ModelSettings } from "./types/provider.ts";

/**
 * Calls the Responses API with the bearer token of a ChatGPT plan sign-in. Every request is streamed and sent
 * with `store: false` and `stream: true`, also when the caller asks for one answer; the stream is read to its end
 * and handed back as that answer. The request leaves out `max_output_tokens` and the sampling settings, which plan
 * usage does not accept, sends the system text as a developer message and puts the function tools in one
 * namespace. The output schema is sent without strict mode, which refuses a schema that has an optional field.
 *
 * The first plan usage refusal or token failure stops the adapter: every later request of every model it made
 * throws the same error without reaching the network, and `failure` holds it.
 */
export class ChatGptAdapter extends ProviderAdapter {
  public static readonly DEFAULT_NAMESPACE: ToolNamespace = {
    name: "tools",
    description: "The tools of this session.",
  };

  private static readonly UNUSED_KEY = "unused";

  private static readonly MODEL_LIST_TIMEOUT_MS = 30_000;

  public override readonly provider = "chatgpt";
  public override readonly keyEnv = undefined;
  private readonly token: BearerToken;
  private readonly namespace: ToolNamespace;
  private readonly modelListTimeoutMs: number;
  private stopped: Error | undefined;

  public constructor(options: ChatGptAdapterOptions) {
    super(options.baseUrl ?? "https://api.openai.com/v1");
    this.token = options.token;
    this.namespace = options.namespace ?? ChatGptAdapter.DEFAULT_NAMESPACE;
    this.modelListTimeoutMs = options.modelListTimeoutMs ?? ChatGptAdapter.MODEL_LIST_TIMEOUT_MS;
  }

  public get failure(): Error | undefined {
    return this.stopped;
  }

  public override effortOptions(effort: Effort): EffortOptions {
    return {
      openai: { reasoningEffort: effort, reasoningSummary: null } satisfies OpenAILanguageModelResponsesOptions,
    };
  }

  /**
   * Lists the models of the signed-in account that are meant for display, in the order the API gives them. The
   * request and its body fail after `modelListTimeoutMs` (30 s unless set), also when the caller gives no signal.
   */
  public async listModels(signal?: AbortSignal): Promise<readonly ChatGptModel[]> {
    const timeout = AbortSignal.timeout(this.modelListTimeoutMs);

    try {
      return await this.models(signal === undefined ? timeout : AbortSignal.any([signal, timeout]));
    } catch (error) {
      if (!timeout.aborted || error !== timeout.reason) throw error;

      throw new Error(`the model list request got no answer within ${this.modelListTimeoutMs / 1000} s`);
    }
  }

  protected override create(settings: ModelSettings, baseURL: string): Exclude<LanguageModel, string> {
    const openai = createOpenAI({ apiKey: ChatGptAdapter.UNUSED_KEY, baseURL });

    return wrapLanguageModel({
      model: openai.responses(settings.model),
      middleware: {
        specificationVersion: "v4",
        transformParams: ({ params }) => this.planParams(params),
        wrapGenerate: ({ doStream }) => this.generate(doStream),
      },
    });
  }

  private async planParams(params: CallParams): Promise<CallParams> {
    const token = await this.bearer();
    const openai = (params.providerOptions?.openai ?? {}) as OpenAIResponsesProviderOptions;
    const { maxOutputTokens: _maxOutputTokens, temperature: _temperature, topP: _topP, ...rest } = params;

    return {
      ...rest,
      includeRawChunks: true,
      headers: { ...params.headers, authorization: `Bearer ${token}` },
      ...(params.tools === undefined ? {} : { tools: params.tools.map((tool) => this.namespaced(tool)) }),
      providerOptions: {
        ...params.providerOptions,
        openai: {
          ...openai,
          store: false,
          strictJsonSchema: false,
          systemMessageMode: "developer",
          include: ["reasoning.encrypted_content"],
        } satisfies OpenAIResponsesProviderOptions,
      },
    };
  }

  private namespaced(tool: NonNullable<CallParams["tools"]>[number]): NonNullable<CallParams["tools"]>[number] {
    if (tool.type !== "function") return tool;

    const openai = tool.providerOptions?.openai ?? {};

    return {
      ...tool,
      providerOptions: {
        ...tool.providerOptions,
        openai: { ...openai, namespace: { name: this.namespace.name, description: this.namespace.description } },
      },
    };
  }

  private async generate(doStream: () => PromiseLike<StreamResult>): Promise<GenerateResult> {
    this.throwIfStopped();

    try {
      return await ChatGptStream.collect(await doStream());
    } catch (error) {
      const refusal = ChatGptError.from(error);

      if (refusal === undefined) throw error;

      throw this.stop(refusal);
    }
  }

  private async models(signal: AbortSignal): Promise<readonly ChatGptModel[]> {
    const response = await fetch(`${this.defaultBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${await this.bearer()}` },
      signal,
    });

    if (!response.ok) {
      const error = ChatGptError.from({ statusCode: response.status, responseBody: await response.text() });

      throw error ?? new Error(`the model list request failed (HTTP ${response.status})`);
    }

    const body = (await response.json()) as ModelListBody;

    if (!Array.isArray(body.models)) throw new Error("the model list response has no models array");

    return body.models.flatMap((entry: unknown) => {
      const model = entry as Record<string, unknown>;

      if (model.visibility !== "list" || typeof model.slug !== "string") return [];

      return [
        { slug: model.slug, displayName: typeof model.display_name === "string" ? model.display_name : model.slug },
      ];
    });
  }

  private async bearer(): Promise<string> {
    this.throwIfStopped();

    try {
      return await this.token();
    } catch (error) {
      throw this.stop(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private stop(error: Error): Error {
    this.stopped ??= error;

    return this.stopped;
  }

  private throwIfStopped(): void {
    if (this.stopped !== undefined) throw this.stopped;
  }
}

import type { LanguageModel } from "ai";
import type { LlmToolResult } from "../../types/llm.ts";
import type { CacheMarker, EffortOptions, ModelSettings, Provider } from "./provider.ts";

export interface AiSdkAdapterOptions {
  readonly model: Exclude<LanguageModel, string>;
  readonly provider: Provider;
  readonly modelId: string;
  readonly maxOutputTokens: number;
  readonly cache?: CacheMarker;
  readonly effort?: EffortOptions;
  readonly maxRetries?: number;
}

export interface AiSdkSettings extends ModelSettings {
  readonly maxOutputTokens: number;
  readonly maxRetries?: number;
}

export interface SessionOptions {
  readonly model: Exclude<LanguageModel, string>;
  readonly maxOutputTokens: number;
  readonly cache: CacheMarker | undefined;
  readonly effort: EffortOptions | undefined;
  readonly maxRetries: number;
}

export interface CacheOptions {
  readonly providerOptions?: CacheMarker;
}

export interface ToolExecuteOptions {
  toolCallId: string;
}

export interface ToolOutputOptions {
  output: LlmToolResult;
}

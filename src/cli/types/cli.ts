import type { Env } from "../../app/types/app.ts";
import type { ChatGptEndpoints } from "../../capability/chatgpt/types/chatgpt.ts";
import type { AiSdkSettings, ProviderAdapter } from "../../harness-kit/ai-sdk/index.ts";
import type { Io } from "../../harness-kit/index.ts";
import type { ProviderLlm } from "../../harnesses/types/harnesses.ts";

export interface CliOptions {
  readonly io: Io;
  readonly env: Env;
  readonly cwd?: string;
  readonly now?: () => number;
  readonly createClient?: (settings: AiSdkSettings, adapter?: ProviderAdapter) => ProviderLlm;
  readonly chatgpt?: ChatGptEndpoints;
}

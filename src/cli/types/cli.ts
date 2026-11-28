import type { Io } from "@kerpetensh/harness-kit";
import type { AiSdkSettings, ProviderAdapter } from "@kerpetensh/harness-kit/ai-sdk";
import type { Env, Stdin } from "../../app/types/app.ts";
import type { ChatGptEndpoints } from "../../capability/chatgpt/types/chatgpt.ts";
import type { ProviderLlm } from "../../harnesses/types/harnesses.ts";

export interface CliOptions {
  readonly io: Io;
  readonly env: Env;
  readonly cwd?: string;
  readonly now?: () => number;
  readonly createClient?: (settings: AiSdkSettings, adapter?: ProviderAdapter) => ProviderLlm;
  readonly chatgpt?: ChatGptEndpoints;
  readonly stdin?: Stdin;
}

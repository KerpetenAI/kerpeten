import type { ChatGptEndpoints } from "../../capability/chatgpt/types/chatgpt.ts";
import type { Cli } from "../../cli/Cli.ts";
import type { AiSdkSettings, ProviderAdapter } from "../../harness-kit/ai-sdk/index.ts";
import type { HarnessApplication } from "../../harness-kit/index.ts";
import type { ProviderLlm } from "../../harnesses/types/harnesses.ts";
import type { Names } from "../Names.ts";

/** The environment variables the program reads. */
export type Env = Readonly<Record<string, string | undefined>>;

/** Builds the client of one model. */
export type ModelClients = (settings: AiSdkSettings, adapter?: ProviderAdapter) => ProviderLlm;

/** Opens the standard input of the program, to be read once to its end. */
export type Stdin = () => ReadableStream<Uint8Array>;

/**
 * The type of every value the project registers by name in the container. A component injects one as
 * `@Inject(Names.NOW) private readonly now!: Instances[Names.NOW];`. The kit's own values are typed by `KitInstances`.
 */
export interface Instances {
  readonly [Names.ENV]: Env;
  readonly [Names.CWD]: string;
  readonly [Names.NOW]: () => number;
  readonly [Names.CHATGPT_ENDPOINTS]: ChatGptEndpoints;
  readonly [Names.MODEL_CLIENTS]: ModelClients;
  readonly [Names.STDIN]: Stdin;
}

/** A started container and the CLI taken from it before the start. */
export interface StartedApp {
  readonly app: HarnessApplication;
  readonly cli: Cli;
}

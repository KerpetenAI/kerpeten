import { Inject, Service } from "@asenajs/ioc";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { ChatGptAdapter, ChatGptError } from "../../harness-kit/ai-sdk/index.ts";
import { errorMessage } from "../../text/text-utils.ts";
import { ChatGptAuthError } from "./ChatGptAuthError.ts";
import { ChatGptTokens } from "./ChatGptTokens.ts";

/**
 * ChatGPT plan usage for the process: the one model adapter that every role shares, so the first plan refusal stops
 * all of them, and what to tell the user when plan usage stopped a run.
 */
@Service("kerpeten:chatgpt-plan")
export class ChatGptPlan {
  public static readonly USAGE_SETTINGS_URL = "https://chatgpt.com/settings/usage";

  @Inject(ChatGptTokens)
  private readonly tokens!: ChatGptTokens;

  @Inject(Names.CHATGPT_ENDPOINTS)
  private readonly endpoints!: Instances[Names.CHATGPT_ENDPOINTS];

  private shared: ChatGptAdapter | undefined;

  /** What to tell the user when ChatGPT plan usage stopped a run, including what to do next. */
  public static failureMessage(error: unknown): string {
    if (error instanceof ChatGptAuthError) return error.message;

    if (!(error instanceof ChatGptError)) return errorMessage(error);

    const cause = error.code ?? (error.status === undefined ? error.kind : `HTTP ${error.status}`);

    switch (error.kind) {
      case "usage_limit":
        return `the ChatGPT plan usage limit is reached (${cause}); review your plan or this app's limit in ChatGPT settings: ${ChatGptPlan.USAGE_SETTINGS_URL}`;

      case "usage_unavailable":
        return `ChatGPT plan usage could not be checked (${cause}); try again later`;

      case "unauthorized":
        return `ChatGPT did not accept the sign-in (${cause}); run \`kerpeten auth login\``;

      default:
        return `ChatGPT plan usage refused the request (${cause}): ${error.message}`;
    }
  }

  /** The adapter every role of the run shares, built on first use. */
  public get adapter(): ChatGptAdapter {
    this.shared ??= new ChatGptAdapter({
      token: () => this.tokens.accessToken(),
      baseUrl: this.endpoints.apiBaseUrl,
    });

    return this.shared;
  }
}

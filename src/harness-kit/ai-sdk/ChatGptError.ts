import type { ChatGptErrorInit, ChatGptErrorKind, ErrorFacts } from "./types/chatgpt.ts";

/**
 * A request that ChatGPT plan usage refused, before the stream opened or in the middle of it. The message holds
 * the error code and the HTTP status, never a token.
 */
export class ChatGptError extends Error {
  private static readonly LIMIT_CODES: ReadonlySet<string> = new Set([
    "subscription_sharing_usage_limit_exceeded",
    "subscription_sharing_workplace_individual_usage_limit_exceeded",
  ]);

  private static readonly UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
    "subscription_sharing_usage_unavailable",
    "subscription_sharing_user_unavailable",
  ]);

  private static readonly UNAUTHORIZED_CODES: ReadonlySet<string> = new Set(["subscription_sharing_invalid_user"]);

  private static readonly REFUSED_PREFIXES: readonly string[] = ["subscription_sharing_", "chatpass_"];

  private static readonly MAX_DETAIL = 300;

  public readonly kind: ChatGptErrorKind;
  public readonly code: string | undefined;
  public readonly status: number | undefined;

  public constructor(init: ChatGptErrorInit) {
    super(ChatGptError.text(init));
    this.name = "ChatGptError";
    this.kind = init.kind;
    this.code = init.code;
    this.status = init.status;
  }

  public static from(error: unknown): ChatGptError | undefined {
    if (error instanceof ChatGptError) return error;

    const facts = ChatGptError.facts(error);
    const kind = ChatGptError.kindOf(facts);

    return kind === undefined ? undefined : new ChatGptError({ kind, ...facts });
  }

  private static kindOf(facts: ErrorFacts): ChatGptErrorKind | undefined {
    const { code, status } = facts;

    if (code !== undefined) {
      if (ChatGptError.LIMIT_CODES.has(code)) return "usage_limit";
      if (ChatGptError.UNAVAILABLE_CODES.has(code)) return "usage_unavailable";
      if (ChatGptError.UNAUTHORIZED_CODES.has(code)) return "unauthorized";
      if (ChatGptError.REFUSED_PREFIXES.some((prefix) => code.startsWith(prefix))) return "refused";
    }

    if (status === 401) return "unauthorized";
    if (status === 403) return "refused";

    return undefined;
  }

  private static facts(error: unknown): ErrorFacts {
    const record = ChatGptError.record(error);
    const status = typeof record?.statusCode === "number" ? record.statusCode : undefined;
    const body = typeof record?.responseBody === "string" ? ChatGptError.parsed(record.responseBody) : undefined;

    const code =
      ChatGptError.codeOf(record) ??
      ChatGptError.codeOf(ChatGptError.record(record?.data)) ??
      ChatGptError.codeOf(body);

    const detail = error instanceof Error ? error.message : (ChatGptError.messageOf(record) ?? "no detail");

    return { code, status, detail: detail.slice(0, ChatGptError.MAX_DETAIL) };
  }

  private static codeOf(value: Record<string, unknown> | undefined): string | undefined {
    if (value === undefined) return undefined;

    if (typeof value.code === "string") return value.code;

    const error = ChatGptError.record(value.error);

    if (typeof error?.code === "string") return error.code;

    const responseError = ChatGptError.record(ChatGptError.record(value.response)?.error);

    return typeof responseError?.code === "string" ? responseError.code : undefined;
  }

  private static messageOf(value: Record<string, unknown> | undefined): string | undefined {
    const responseError = ChatGptError.record(ChatGptError.record(value?.response)?.error);

    return typeof responseError?.message === "string" ? responseError.message : undefined;
  }

  private static record(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
  }

  private static parsed(text: string): Record<string, unknown> | undefined {
    try {
      return ChatGptError.record(JSON.parse(text));
    } catch {
      return undefined;
    }
  }

  private static text(init: ChatGptErrorInit): string {
    const facts = [init.code, init.status === undefined ? undefined : `HTTP ${init.status}`].filter(
      (part) => part !== undefined,
    );

    return `ChatGPT plan usage stopped the request (${facts.length > 0 ? facts.join(", ") : init.kind}): ${init.detail}`;
  }
}

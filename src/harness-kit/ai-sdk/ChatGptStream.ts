import { ChatGptError } from "./ChatGptError.ts";
import type {
  EndPart,
  FinishPart,
  GeneratedContent,
  GenerateResult,
  IncompleteEvent,
  StreamPart,
  StreamResult,
  TextSlot,
} from "./types/chatgpt.ts";

/**
 * Reads one streamed Responses API answer into the result of a non-streaming call. The answer counts only when
 * the stream carried `response.completed`; an error event, `response.incomplete` or a stream that ends without
 * `response.completed` throws.
 */
export class ChatGptStream {
  private static readonly COMPLETED = "response.completed";

  private static readonly INCOMPLETE = "response.incomplete";

  private readonly content: GeneratedContent[] = [];
  private readonly open = new Map<string, TextSlot>();
  private warnings: GenerateResult["warnings"] = [];
  private finish: FinishPart | undefined;
  private metadata: GenerateResult["response"] = {};
  private terminal = false;
  private incomplete: string | undefined;

  public static async collect(result: StreamResult): Promise<GenerateResult> {
    return new ChatGptStream().read(result);
  }

  private static rawType(value: unknown): string | undefined {
    if (typeof value !== "object" || value === null) return undefined;

    const type = (value as Record<string, unknown>).type;

    return typeof type === "string" ? type : undefined;
  }

  private static incompleteReason(value: unknown): string {
    const response = (value as IncompleteEvent).response;
    const reason = response?.incomplete_details?.reason;

    return typeof reason === "string" ? reason.replace(/[^A-Za-z0-9_.-]/gu, "?").slice(0, 64) : "no reason given";
  }

  private static asError(error: unknown): Error {
    if (error instanceof Error) return error;

    return new Error(`the ChatGPT response stream failed (${ChatGptStream.rawType(error) ?? "unknown event"})`);
  }

  private async read(result: StreamResult): Promise<GenerateResult> {
    const reader = result.stream.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        this.take(value);
      }
    } catch (error) {
      await reader.cancel(error);

      throw error;
    } finally {
      reader.releaseLock();
    }

    if (this.incomplete !== undefined) throw new Error(`the ChatGPT response is incomplete (${this.incomplete})`);

    if (!this.terminal || this.finish === undefined) {
      throw new Error("the ChatGPT response stream ended before response.completed");
    }

    return {
      content: this.content,
      finishReason: this.finish.finishReason,
      usage: this.finish.usage,
      ...(this.finish.providerMetadata === undefined ? {} : { providerMetadata: this.finish.providerMetadata }),
      ...(result.request === undefined ? {} : { request: result.request }),
      response: { ...this.metadata, ...result.response },
      warnings: this.warnings,
    };
  }

  private take(part: StreamPart): void {
    switch (part.type) {
      case "text-start":
      case "reasoning-start": {
        const slot = {
          type: part.type === "text-start" ? ("text" as const) : ("reasoning" as const),
          text: "",
          ...(part.providerMetadata === undefined ? {} : { providerMetadata: part.providerMetadata }),
        };

        this.content.push(slot);
        this.open.set(`${slot.type}:${part.id}`, slot);
        break;
      }

      case "text-delta":
      case "reasoning-delta": {
        const slot = this.open.get(`${part.type === "text-delta" ? "text" : "reasoning"}:${part.id}`);

        if (slot !== undefined) slot.text += part.delta;

        break;
      }

      case "text-end":
      case "reasoning-end":
        this.end(part);
        break;

      case "tool-input-start":
      case "tool-input-delta":
      case "tool-input-end":
      case "ping":
        break;

      case "stream-start":
        this.warnings = part.warnings;
        break;

      case "response-metadata": {
        const { type: _type, ...metadata } = part;

        this.metadata = metadata;
        break;
      }

      case "finish":
        this.finish = part;
        break;

      case "raw": {
        const type = ChatGptStream.rawType(part.rawValue);

        if (type === ChatGptStream.COMPLETED) this.terminal = true;
        if (type === ChatGptStream.INCOMPLETE) this.incomplete = ChatGptStream.incompleteReason(part.rawValue);

        break;
      }

      case "error":
        throw ChatGptError.from(part.error) ?? ChatGptStream.asError(part.error);

      default:
        this.content.push(part);
    }
  }

  private end(part: EndPart): void {
    const key = `${part.type === "text-end" ? "text" : "reasoning"}:${part.id}`;
    const slot = this.open.get(key);

    this.open.delete(key);

    if (slot === undefined || part.providerMetadata === undefined) return;

    slot.providerMetadata = { ...slot.providerMetadata, ...part.providerMetadata };
  }
}

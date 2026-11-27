import type { SessionInput } from "../../harness-kit/index.ts";
import type { ProviderLlm } from "../types/harnesses.ts";
import { RecordingSession } from "./RecordingSession.ts";

export class RecordingLlm implements ProviderLlm {
  public readonly provider: ProviderLlm["provider"];
  public readonly model: string;
  private readonly inner: ProviderLlm;
  private latest: RecordingSession | undefined;

  public constructor(inner: ProviderLlm) {
    this.inner = inner;
    this.provider = inner.provider;
    this.model = inner.model;
  }

  public start(input: SessionInput): RecordingSession {
    const session = new RecordingSession(this.inner.start(input));

    this.latest = session;

    return session;
  }

  public get started(): RecordingSession | undefined {
    return this.latest;
  }

  public takeStarted(): RecordingSession | undefined {
    const session = this.latest;

    this.latest = undefined;

    return session;
  }
}

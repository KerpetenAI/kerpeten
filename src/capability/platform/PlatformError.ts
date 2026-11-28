import type { PlatformFailure } from "./types/platform.ts";

/** A read from a platform that failed: the kind of failure and a message that says what to do. It never holds a token. */
export class PlatformError extends Error {
  public readonly kind: PlatformFailure;

  public constructor(kind: PlatformFailure, message: string) {
    super(message);
    this.name = "PlatformError";
    this.kind = kind;
  }
}

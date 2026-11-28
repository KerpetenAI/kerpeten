/**
 * What a program printed, kept up to a byte limit. `take` takes the next chunk and says whether the program may go
 * on: a chunk that goes over the limit is kept up to the limit, and from then on the output is `over`.
 */
export class LimitedOutput {
  private readonly limit: number;

  private readonly chunks: Uint8Array[] = [];

  private size = 0;

  private exceeded = false;

  public constructor(limit: number) {
    this.limit = limit;
  }

  /** Whether the program printed more than the limit. */
  public get over(): boolean {
    return this.exceeded;
  }

  /** The bytes that were kept, at most the limit. */
  public get bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }

  public take(chunk: Uint8Array): boolean {
    const room = this.limit - this.size;

    if (chunk.length > room) {
      this.chunks.push(chunk.subarray(0, room));
      this.size = this.limit;
      this.exceeded = true;

      return false;
    }

    this.chunks.push(chunk);
    this.size += chunk.length;

    return true;
  }
}

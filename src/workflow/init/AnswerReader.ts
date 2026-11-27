import type { Stdin } from "../../app/types/app.ts";
import { LineSplitter } from "../../text/LineSplitter.ts";
import { errorMessage } from "../../text/text-utils.ts";
import type { SplitLine } from "../../text/types/text.ts";
import { InitInputError } from "./InitInputError.ts";

/**
 * Reads standard input one line at a time, and only when a line is asked for, so that each question is printed before
 * its answer is read. Standard input is opened on the first read.
 */
export class AnswerReader {
  public static readonly MAX_CHARS = 1000;

  private readonly open: Stdin;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private readonly splitter = new LineSplitter(AnswerReader.MAX_CHARS);
  private readonly queued: SplitLine[] = [];
  private chunks: AsyncIterator<Uint8Array> | undefined;
  private ended = false;

  public constructor(open: Stdin) {
    this.open = open;
  }

  /** The next line; throws an `InitInputError` when standard input ends first, cannot be read or is not UTF-8. */
  public async next(): Promise<SplitLine> {
    for (;;) {
      const line = this.queued.shift();

      if (line !== undefined) return line;

      if (this.ended) {
        throw new InitInputError("standard input ended before every question was answered; no file was written");
      }

      await this.pull();
    }
  }

  private async pull(): Promise<void> {
    this.chunks ??= this.open()[Symbol.asyncIterator]();

    let chunk: IteratorResult<Uint8Array>;

    try {
      chunk = await this.chunks.next();
    } catch (error) {
      throw new InitInputError(`standard input cannot be read (${errorMessage(error)}); no file was written`);
    }

    try {
      if (chunk.done) {
        this.ended = true;

        this.queued.push(...this.splitter.push(this.decoder.decode()), ...this.splitter.end());

        return;
      }

      this.queued.push(...this.splitter.push(this.decoder.decode(chunk.value, { stream: true })));
    } catch {
      throw new InitInputError("standard input is not UTF-8 text; no file was written");
    }
  }
}

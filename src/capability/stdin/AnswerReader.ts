import { Inject } from "@asenajs/ioc";
import { Capability, CapabilityBase } from "@kerpetensh/harness-kit";
import { Names } from "../../app/Names.ts";
import type { Instances } from "../../app/types/app.ts";
import { LineSplitter } from "../../text/LineSplitter.ts";
import { errorMessage } from "../../text/text-utils.ts";
import type { SplitLine } from "../../text/types/text.ts";
import { AnswerInputError } from "./AnswerInputError.ts";

/**
 * Reads standard input one line at a time, and only when a line is asked for, so that each question is printed before
 * its answer is read. Standard input is opened on the first read. A run builds one reader, which holds the lines it
 * has read ahead.
 */
@Capability({
  name: "answer-reader",
  description:
    "Reads the answers to the questions of a command from standard input, one line at a time and only when a line is asked for.",
  scope: "run",
})
export class AnswerReader extends CapabilityBase {
  public static readonly MAX_CHARS = 1000;

  @Inject(Names.STDIN)
  private readonly stdin!: Instances[Names.STDIN];

  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private readonly splitter = new LineSplitter(AnswerReader.MAX_CHARS);
  private readonly queued: SplitLine[] = [];
  private chunks: AsyncIterator<Uint8Array> | undefined;
  private ended = false;

  /** The next line; throws an `AnswerInputError` when standard input ends first, cannot be read or is not UTF-8. */
  public async next(): Promise<SplitLine> {
    for (;;) {
      const line = this.queued.shift();

      if (line !== undefined) return line;

      if (this.ended) throw new AnswerInputError("standard input ended before every question was answered");

      await this.pull();
    }
  }

  private async pull(): Promise<void> {
    this.chunks ??= this.stdin()[Symbol.asyncIterator]();

    let chunk: IteratorResult<Uint8Array>;

    try {
      chunk = await this.chunks.next();
    } catch (error) {
      throw new AnswerInputError(`standard input cannot be read (${errorMessage(error)})`);
    }

    try {
      if (chunk.done) {
        this.ended = true;

        this.queued.push(...this.splitter.push(this.decoder.decode()), ...this.splitter.end());

        return;
      }

      this.queued.push(...this.splitter.push(this.decoder.decode(chunk.value, { stream: true })));
    } catch {
      throw new AnswerInputError("standard input is not UTF-8 text");
    }
  }
}

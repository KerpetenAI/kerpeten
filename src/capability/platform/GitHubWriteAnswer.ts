import { shortLine, terminalLine } from "../../text/text-utils.ts";
import { GitHubCli } from "./GitHubCli.ts";
import type { RemoteProject } from "./RemoteProject.ts";
import { githubWriteErrorSchema, githubWrittenSchema } from "./schemas/github-schema.ts";
import type { GitHubBlock, GitHubWriteResult } from "./types/github.ts";
import type { PlatformExit, PlatformRead } from "./types/platform.ts";

/**
 * Says what an answer of `gh api` to a write means. It is the one place that tells the three cases apart:
 *
 * - `written`: gh ended with 0 and printed what GitHub made, with its id.
 * - `invalid`: GitHub answered HTTP 422, so it wrote nothing. For a review of line comments that is the answer to a
 *   comment whose line is not in the diff as GitHub sees it, and the caller finds that comment by sending less.
 * - `failed`: everything else, with a message that starts with `not written:` when GitHub wrote nothing for sure, and
 *   with `it is not known whether GitHub wrote it:` when the call was stopped at its time or output limit or its
 *   answer cannot be read.
 *
 * A 422 that no line causes must not be taken for one. `BLOCKS` lists the answers that are known to be such: each is
 * `failed`, with what to do. An answer that is not listed stays `invalid`. GitHub's own text is kept in every reason
 * and message; it is outside data, so it is brought to one line without control characters and cut to `MAX_TEXT`
 * characters.
 */
export class GitHubWriteAnswer {
  public static readonly MAX_TEXT = 500;

  private static readonly INVALID = "422";

  private static readonly BLOCKS: readonly GitHubBlock[] = [
    {
      answer: /pending review/i,
      advice:
        "your account has a review on this pull request that is not submitted yet, and GitHub takes no other review beside it: submit or delete that review on the page of the pull request and run again",
    },
  ];

  private static readonly MS_PER_SECOND = 1000;

  private static readonly AGAIN = "run again: what is already written is not written a second time";

  /** What the answer `read` of gh to a write for pull request `number` of `project` means. */
  public static of(read: PlatformRead, number: number, project: RemoteProject): GitHubWriteResult {
    if (read.kind === "timed_out") {
      return GitHubWriteAnswer.unknown(`gh did not finish within ${read.ms / GitHubWriteAnswer.MS_PER_SECOND} seconds`);
    }

    if (read.kind === "too_large") return GitHubWriteAnswer.unknown(`gh printed more than ${read.bytes} bytes`);

    if (read.exitCode === 0) {
      const written = githubWrittenSchema.safeParse(GitHubWriteAnswer.json(read));

      return written.success
        ? { kind: "written", id: written.data.id }
        : GitHubWriteAnswer.unknown("gh ended without an error, but its answer does not name what GitHub made");
    }

    const refusal = GitHubWriteAnswer.refusal(read);

    if (refusal === undefined) return GitHubWriteAnswer.failed(read, number, project);

    const block = GitHubWriteAnswer.BLOCKS.find((candidate) => candidate.answer.test(refusal));

    if (block === undefined) return { kind: "invalid", reason: refusal };

    return { kind: "failed", message: `not written: ${block.advice} (GitHub answered: ${refusal})` };
  }

  /**
   * A write GitHub did not make for a reason that is no 422. GitHub answers 404 to a write for something that is gone
   * and to one from an account that may not write, so the message of a read, which names the number, does not fit.
   */
  private static failed(read: PlatformExit, number: number, project: RemoteProject): GitHubWriteResult {
    const failure = GitHubCli.failure(read, number, project);

    if (failure.kind !== "not_found") return { kind: "failed", message: `not written: ${failure.message}` };

    return {
      kind: "failed",
      message: `not written: GitHub did not find what the write is for (HTTP 404): pull request ${number} or the comment was removed, or the account gh is signed in to ${project.host} with may not write to ${project.path}`,
    };
  }

  private static unknown(reason: string): GitHubWriteResult {
    return {
      kind: "failed",
      message: `it is not known whether GitHub wrote it: ${reason}; ${GitHubWriteAnswer.AGAIN}`,
    };
  }

  private static json(read: PlatformExit): unknown {
    try {
      return JSON.parse(read.stdout.toString("utf8"));
    } catch {
      return undefined;
    }
  }

  /**
   * GitHub's text for a request it refused with HTTP 422, or `undefined` when the answer is no 422. gh prints the
   * body of the error on stdout and one line with the status on stderr; the status is taken from either. The text is
   * the message of the body and its errors, or the line of stderr when the body cannot be read.
   */
  private static refusal(read: PlatformExit): string | undefined {
    const body = githubWriteErrorSchema.safeParse(GitHubWriteAnswer.json(read));
    const stderr = terminalLine(read.stderr);
    const status = body.success ? body.data.status : undefined;

    if (status !== GitHubWriteAnswer.INVALID && !stderr.includes(`HTTP ${GitHubWriteAnswer.INVALID}`)) {
      return undefined;
    }

    const texts = body.success ? [body.data.message, ...GitHubWriteAnswer.errors(body.data.errors)] : [];
    const said = texts.filter((text) => text !== undefined && text.trim() !== "").join(": ");

    return shortLine(terminalLine(said === "" ? stderr : said), GitHubWriteAnswer.MAX_TEXT);
  }

  /** The texts of the `errors` of an error body: a list of texts or of objects with a `message`, or one text. */
  private static errors(errors: unknown): string[] {
    const list = Array.isArray(errors) ? errors : [errors];

    return list.flatMap((entry: unknown) => {
      if (typeof entry === "string") return [entry];

      if (typeof entry !== "object" || entry === null) return [];

      return "message" in entry && typeof entry.message === "string" ? [entry.message] : [JSON.stringify(entry)];
    });
  }
}

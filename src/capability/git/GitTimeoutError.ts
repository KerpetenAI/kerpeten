/**
 * A git command that did not finish within the time a read of git gets and was stopped. The message names the git
 * command and the limit, never the other arguments, which may hold outside data.
 */
export class GitTimeoutError extends Error {
  public readonly timeoutMs: number;

  public constructor(args: readonly string[], timeoutMs: number) {
    super(`git ${args[0] ?? ""} did not finish within ${timeoutMs / 1000} s and was stopped`);
    this.name = "GitTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

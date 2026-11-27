export class GitError extends Error {
  public readonly exitCode: number;
  public readonly stderr: string;

  public constructor(args: readonly string[], exitCode: number, stderr: string) {
    super(`git ${args[0] ?? ""} failed (exit ${exitCode}): ${stderr.trim().split("\n")[0] ?? ""}`);
    this.name = "GitError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

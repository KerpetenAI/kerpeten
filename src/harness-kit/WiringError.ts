export class WiringError extends Error {
  public readonly problems: readonly string[];

  public constructor(problems: readonly string[]) {
    super(["the harness wiring is wrong:", ...problems.map((problem) => `- ${problem}`)].join("\n"));
    this.problems = problems;
  }
}

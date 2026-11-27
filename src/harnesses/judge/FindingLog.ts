import type { HarnessLogFields, HarnessLogger } from "../../harness-kit/index.ts";

/**
 * The log of one judge call. It adds the number of the finding to every line, so the lines of calls that run at the
 * same time can be told apart.
 */
export class FindingLog implements HarnessLogger {
  private readonly log: HarnessLogger;
  private readonly finding: number;

  public constructor(log: HarnessLogger, finding: number) {
    this.log = log;
    this.finding = finding;
  }

  public debug(message: string, fields?: HarnessLogFields): void {
    this.log.debug(message, { finding: this.finding, ...fields });
  }

  public info(message: string, fields?: HarnessLogFields): void {
    this.log.info(message, { finding: this.finding, ...fields });
  }

  public warn(message: string, fields?: HarnessLogFields): void {
    this.log.warn(message, { finding: this.finding, ...fields });
  }
}

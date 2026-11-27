import { Logger } from "../../src/log/Logger.ts";
import type { LogFields } from "../../src/log/types/log.ts";
import type { CapturedLine } from "./types/harnesses.ts";

export class CapturingLogger extends Logger {
  private readonly lines: CapturedLine[];
  private readonly boundFields: LogFields;

  public constructor(lines: CapturedLine[], boundFields: LogFields = {}) {
    super({ level: "debug", write: () => {} });
    this.lines = lines;
    this.boundFields = boundFields;
  }

  public override debug(message: string, fields: LogFields = {}): void {
    this.capture("debug", message, fields);
  }

  public override info(message: string, fields: LogFields = {}): void {
    this.capture("info", message, fields);
  }

  public override warn(message: string, fields: LogFields = {}): void {
    this.capture("warn", message, fields);
  }

  public override error(message: string, fields: LogFields = {}): void {
    this.capture("error", message, fields);
  }

  public override child(fields: LogFields): Logger {
    return new CapturingLogger(this.lines, { ...this.boundFields, ...fields });
  }

  private capture(level: string, message: string, fields: LogFields): void {
    this.lines.push({ level, message, fields: { ...this.boundFields, ...fields } });
  }
}

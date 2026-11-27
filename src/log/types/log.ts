export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogValue = string | number | boolean | undefined;

export type LogFields = Readonly<Record<string, LogValue>>;

export interface LoggerOptions {
  readonly level: LogLevel;
  readonly write: (line: string) => void;
  readonly now?: () => Date;
}

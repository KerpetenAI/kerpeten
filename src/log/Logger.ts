import { Inject, Service } from "@asenajs/ioc";
import { Names } from "../app/Names.ts";
import type { Instances } from "../app/types/app.ts";
import { type KitInstances, KitNames } from "../harness-kit/index.ts";
import { safeJson } from "../text/text-utils.ts";
import type { LogFields, LoggerOptions, LogLevel, LogValue } from "./types/log.ts";

/**
 * Writes log lines of a level and above. The container builds the program's logger, which writes to the error stream
 * of the kit's `Io` at the level `KERPETEN_LOG_LEVEL` names, `info` when it names none. A logger built by hand takes
 * its options; `child` adds fields to every line.
 */
@Service("kerpeten:logger")
export class Logger {
  private static readonly RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

  private static readonly LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

  private static readonly BARE = /^[A-Za-z0-9_./:@+-]+$/;

  private static readonly KEY = /^[A-Za-z_][A-Za-z0-9_.]*$/;

  @Inject(Names.ENV)
  private readonly env: Instances[Names.ENV] | undefined;

  @Inject(KitNames.IO)
  private readonly io: KitInstances[KitNames.IO] | undefined;

  private readonly options: LoggerOptions | undefined;
  private readonly bound: LogFields;

  public constructor(options?: LoggerOptions, bound: LogFields = {}) {
    this.options = options;
    this.bound = bound;
  }

  public static silent(): Logger {
    return new Logger({ level: "error", write: () => {} });
  }

  public static parseLevel(value: string | undefined): LogLevel | undefined {
    if (value === undefined) return undefined;

    const lowered = value.trim().toLowerCase();

    return Logger.LEVELS.find((level) => level === lowered);
  }

  public static formatLine(time: Date, level: LogLevel, message: string, fields: LogFields): string {
    const parts = [time.toISOString(), level.toUpperCase(), safeJson(message)];

    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;

      parts.push(`${Logger.formatKey(key)}=${Logger.formatValue(value)}`);
    }

    return parts.join(" ");
  }

  public debug(message: string, fields?: LogFields): void {
    this.emit("debug", message, fields);
  }

  public info(message: string, fields?: LogFields): void {
    this.emit("info", message, fields);
  }

  public warn(message: string, fields?: LogFields): void {
    this.emit("warn", message, fields);
  }

  public error(message: string, fields?: LogFields): void {
    this.emit("error", message, fields);
  }

  public child(fields: LogFields): Logger {
    return new Logger(this.settings, { ...this.bound, ...fields });
  }

  private static formatValue(value: Exclude<LogValue, undefined>): string {
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : safeJson(String(value));
    if (typeof value === "boolean") return String(value);

    return value !== "" && Logger.BARE.test(value) ? value : safeJson(value);
  }

  private static formatKey(key: string): string {
    return Logger.KEY.test(key) ? key : safeJson(key);
  }

  private get settings(): LoggerOptions {
    if (this.options !== undefined) return this.options;

    if (this.env === undefined || this.io === undefined) {
      throw new Error("a Logger the container did not build needs its options");
    }

    return { level: Logger.parseLevel(this.env.KERPETEN_LOG_LEVEL) ?? "info", write: this.io.err };
  }

  private emit(level: LogLevel, message: string, fields: LogFields = {}): void {
    const { level: least, write, now } = this.settings;

    if (Logger.RANK[level] < Logger.RANK[least]) return;

    write(Logger.formatLine(now === undefined ? new Date() : now(), level, message, { ...this.bound, ...fields }));
  }
}

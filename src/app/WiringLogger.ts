import type { IocLogger } from "@asenajs/ioc";

/**
 * The container's logger. Its warnings are wiring mistakes, so a warning stops the start. Its errors are reported again
 * by the failure that `start()` throws and the count that `stop()` returns, so they are not written twice.
 */
export class WiringLogger implements IocLogger {
  public info(): void {}

  public debug(): void {}

  public error(): void {}

  public warn(message: string): void {
    throw new Error(`the container warned: ${message}`);
  }
}

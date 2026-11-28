import { errorMessage } from "../harness-kit-utils.ts";
import { CapabilityBase } from "./CapabilityBase.ts";
import type { PipedProcess, ProcessOutcome, ProcessResult, ProcessSettings } from "./types/capability.ts";

/**
 * A capability that runs a program. It reads the command, the fixed arguments, the working directory and the
 * environment from `processSettings` each time it starts the program, so a run capability can give them from the
 * values of its run.
 */
export abstract class ProcessCapability extends CapabilityBase {
  protected abstract processSettings(): ProcessSettings;

  protected async collect(args: readonly string[]): Promise<ProcessResult> {
    const proc = this.spawn(args);

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { exitCode, stdout: Buffer.from(stdout), stderr };
  }

  protected async stream(
    args: readonly string[],
    take: (chunk: Uint8Array) => boolean,
    timeoutMs: number,
  ): Promise<ProcessOutcome> {
    let proc: PipedProcess;

    try {
      proc = this.spawn(args);
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;

      return { kind: "not_started", error: errorMessage(error), ...(code === undefined ? {} : { code }) };
    }

    const stderr = new Response(proc.stderr).text();
    const reader = proc.stdout.getReader();
    let timedOut = false;
    let stopped = false;

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
      reader.cancel().catch(() => {});
    }, timeoutMs);

    try {
      while (!stopped) {
        const { done, value } = await reader.read();

        if (done) break;

        stopped = !take(value);
      }
    } catch (error) {
      if (!timedOut) throw error;
    } finally {
      clearTimeout(timer);
    }

    if (timedOut) return { kind: "timed_out", timeoutMs };

    if (stopped) {
      proc.kill("SIGKILL");
      await reader.cancel().catch(() => {});

      return { kind: "stopped" };
    }

    const exitCode = await proc.exited;

    return { kind: "exited", exitCode, stderr: await stderr };
  }

  private spawn(args: readonly string[]): PipedProcess {
    const { command, fixedArgs, cwd, env } = this.processSettings();

    return Bun.spawn([command, ...fixedArgs, ...args], {
      cwd,
      ...(env === "inherit" ? {} : { env: { ...env } }),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  }
}

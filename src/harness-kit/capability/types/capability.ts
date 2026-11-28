import type { RunClass } from "../../run/types/run.ts";
import type { CapabilityBase } from "../CapabilityBase.ts";

export interface CapabilitySpec {
  readonly name: string;
  readonly description: string;
  readonly permission?: string;
  /** `"run"` makes the capability a run component, built once per run; left out, it is a singleton of the program. */
  readonly scope?: "run";
}

export type PermissionGrant =
  | { readonly group: string; readonly every: true }
  | { readonly group: string; readonly every: false; readonly permissions: readonly string[] };

export type CapabilityClass<T extends CapabilityBase = CapabilityBase> = abstract new (...args: never[]) => T;

/**
 * The options of `@Use`. A use is required unless `required` is `false`; an optional use of a tool reads `undefined`
 * when the run's permission group does not give it.
 */
export interface UseOptions {
  readonly required?: boolean;
}

/** One `@Use` field: its name, the class it takes and whether it is required. */
export interface CapabilityUse {
  readonly field: string;
  readonly capability: RunClass;
  readonly required: boolean;
}

export type ProcessEnv = "inherit" | Readonly<Record<string, string>>;

export interface ProcessSettings {
  readonly command: string;
  readonly fixedArgs: readonly string[];
  readonly cwd: string;
  readonly env: ProcessEnv;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: Buffer;
  readonly stderr: string;
}

/**
 * How a streamed program ended. A program that did not start gives the error text and, when the system named one,
 * the error code: `ENOENT` for a program that is not found.
 */
export type ProcessOutcome =
  | { readonly kind: "not_started"; readonly error: string; readonly code?: string }
  | { readonly kind: "timed_out"; readonly timeoutMs: number }
  | { readonly kind: "stopped" }
  | { readonly kind: "exited"; readonly exitCode: number; readonly stderr: string };

export type PipedProcess = Bun.Subprocess<"ignore", "pipe", "pipe">;

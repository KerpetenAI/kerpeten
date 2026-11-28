import {
  Capability,
  ProcessCapability,
  type ProcessOutcome,
  type ProcessSettings,
} from "../../src/harness-kit/index.ts";

/** A capability whose program does not exist, to see how a start that fails is reported. */
@Capability({ name: "missing-program", description: "Starts a program that is not there." })
export class MissingProgram extends ProcessCapability {
  private static readonly START_TIMEOUT_MS = 1000;

  public start(): Promise<ProcessOutcome> {
    return this.stream([], () => true, MissingProgram.START_TIMEOUT_MS);
  }

  protected processSettings(): ProcessSettings {
    return { command: "/nowhere/kerpeten-test-program-that-is-not-there", fixedArgs: [], cwd: ".", env: {} };
  }
}

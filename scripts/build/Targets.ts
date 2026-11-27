import type { Target } from "./types/build.ts";

/** The platforms a standalone binary is built for. */
export class Targets {
  public static readonly ALL: readonly Target[] = ["linux-x64", "linux-arm64", "darwin-arm64"];

  public static is(value: string): value is Target {
    return (Targets.ALL as readonly string[]).includes(value);
  }
}

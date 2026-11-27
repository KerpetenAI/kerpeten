import type { Env } from "../../../src/app/types/app.ts";

export interface KerpetenRun {
  readonly env?: Env;
  readonly now?: () => number;
}

import { RunService } from "../../../src/harness-kit/index.ts";

/** The test closes the cycle by giving it a `@Use` of `CycleA`, which this file cannot import. */
@RunService("test:cycle-b")
export class CycleB {}

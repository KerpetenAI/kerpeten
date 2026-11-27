import { RunService } from "../../../src/harness-kit/index.ts";

/** The test closes the cycle by giving it a `@Use` of `KnotA`, which this file cannot import. */
@RunService("test:knot-b")
export class KnotB {}

import { RunService, Use } from "../../../src/harness-kit/index.ts";
import { CycleB } from "./CycleB.ts";

@RunService("test:cycle-a")
export class CycleA {
  @Use(CycleB)
  public readonly b!: CycleB;
}

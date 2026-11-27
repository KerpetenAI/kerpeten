import { RunService, Use } from "../../../src/harness-kit/index.ts";
import { KnotB } from "./KnotB.ts";
import { LeafService } from "./LeafService.ts";

@RunService("test:knot-a")
export class KnotA {
  @Use(LeafService)
  public readonly leaf!: LeafService;

  @Use(KnotB)
  public readonly b!: KnotB;
}

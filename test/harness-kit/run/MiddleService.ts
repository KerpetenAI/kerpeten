import { OnStart } from "@asenajs/ioc";
import { RunService, Use } from "../../../src/harness-kit/index.ts";
import { BuildOrder } from "./BuildOrder.ts";
import { LeafService } from "./LeafService.ts";

@RunService("test:middle")
export class MiddleService {
  @Use(LeafService)
  public readonly leaf!: LeafService;

  @OnStart()
  public done(): void {
    BuildOrder.names.push(this.leaf instanceof LeafService ? "middle" : "middle without its leaf");
  }
}

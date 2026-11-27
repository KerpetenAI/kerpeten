import { OnStart } from "@asenajs/ioc";
import { RunService, Use } from "../../../src/harness-kit/index.ts";
import { BuildOrder } from "./BuildOrder.ts";
import { MiddleService } from "./MiddleService.ts";

@RunService("test:top")
export class TopService {
  @Use(MiddleService)
  public readonly middle!: MiddleService;

  @OnStart()
  public done(): void {
    BuildOrder.names.push("top");
  }
}

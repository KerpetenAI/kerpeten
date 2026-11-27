import { OnStart } from "@asenajs/ioc";
import { RunService } from "../../../src/harness-kit/index.ts";
import { BuildOrder } from "./BuildOrder.ts";

@RunService("test:leaf")
export class LeafService {
  @OnStart()
  public async done(): Promise<void> {
    await Bun.sleep(3);

    BuildOrder.names.push("leaf");
  }
}

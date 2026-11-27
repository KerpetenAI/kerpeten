import { RunService, Use } from "../../../src/harness-kit/index.ts";
import { LoopService } from "./LoopService.ts";

@RunService("test:loop-watcher")
export class LoopWatcher {
  @Use(LoopService)
  public readonly loop!: LoopService;
}

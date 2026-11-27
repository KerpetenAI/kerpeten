import { RunService, Use } from "../../../src/harness-kit/index.ts";

@RunService("test:loop")
export class LoopService {
  @Use(LoopService)
  public readonly self!: LoopService;
}

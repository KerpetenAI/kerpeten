import { RunService } from "../../../src/harness-kit/index.ts";

@RunService("test:twin")
export class TwinSource {
  public static built = 0;

  public constructor() {
    TwinSource.built++;
  }
}

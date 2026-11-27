import { OnStart } from "@asenajs/ioc";
import { RunService, RunValue } from "../../../src/harness-kit/index.ts";

/** Counts its builds, reads the run value `label` and warms up in an awaited @OnStart. */
@RunService("test:counted")
export class CountedService {
  public static built = 0;

  public readonly id: number;

  @RunValue("label")
  public readonly label!: string;

  private warmed = false;

  public constructor() {
    CountedService.built++;
    this.id = CountedService.built;
  }

  public get warm(): boolean {
    return this.warmed;
  }

  @OnStart()
  public async warmUp(): Promise<void> {
    await Bun.sleep(5);

    this.warmed = this.label !== "";
  }
}

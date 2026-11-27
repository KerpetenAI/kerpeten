import { OnStart } from "@asenajs/ioc";
import { Capability, CapabilityBase } from "../../../src/harness-kit/index.ts";

/** A run capability whose build always throws `FAILURE`; it counts the builds the runs start. */
@Capability({
  name: "broken-source",
  description: "A source whose build always fails.",
  permission: "repo:read",
  scope: "run",
})
export class BrokenSource extends CapabilityBase {
  public static readonly FAILURE = new Error("the broken source cannot be built");

  public static builds = 0;

  @OnStart()
  public async open(): Promise<void> {
    BrokenSource.builds++;

    throw BrokenSource.FAILURE;
  }

  public read(path: string): string {
    return path;
  }
}

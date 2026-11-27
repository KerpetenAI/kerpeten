import { Capability, CapabilityBase, RunValue } from "../../../src/harness-kit/index.ts";

/** A singleton capability that counts its builds and reads the run value `label` of the run it is read in. */
@Capability({ name: "shared-source", description: "A source shared by every run.", permission: "repo:read" })
export class SharedSource extends CapabilityBase {
  public static built = 0;

  @RunValue("label")
  public readonly label!: string;

  public constructor() {
    super();
    SharedSource.built++;
  }
}

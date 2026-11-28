import { PlatformChoice } from "../../../src/capability/platform/PlatformChoice.ts";
import type { PlatformKind, PlatformWriter } from "../../../src/capability/platform/types/platform.ts";

/** A platform choice that is GitHub with the writer it was given, or a platform without a writer when it was given none. */
export class GivenPlatformChoice extends PlatformChoice {
  private readonly given: PlatformWriter | undefined;

  public constructor(given?: PlatformWriter) {
    super();
    this.given = given;
  }

  public override async kind(): Promise<PlatformKind> {
    return this.given === undefined ? "gitlab" : "github";
  }

  public override async writer(): Promise<PlatformWriter | undefined> {
    return this.given;
  }
}

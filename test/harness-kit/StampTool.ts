import type { z } from "zod";
import { Tool, Use } from "../../src/harness-kit/index.ts";
import { Marker } from "./Marker.ts";
import { SearchCapability } from "./SearchCapability.ts";
import { stampInput } from "./schemas/fake-schema.ts";
import type { Stamp } from "./types/fakes.ts";

@Tool({ name: "stamp", description: "Reads its marker before and after a wait.", input: stampInput })
export class StampTool {
  public static built = 0;

  public static readonly stamps: Stamp[] = [];

  @Use(Marker)
  private readonly marker!: Marker;

  @Use(SearchCapability, { required: false })
  private readonly searcher: SearchCapability | undefined;

  public constructor() {
    StampTool.built++;
  }

  public async execute(input: z.infer<typeof stampInput>): Promise<unknown> {
    const before = this.marker.id;

    await Bun.sleep(input.waitMs);

    const stamp: Stamp = { before, after: this.marker.id, searched: this.searcher !== undefined };

    StampTool.stamps.push(stamp);

    return stamp;
  }
}

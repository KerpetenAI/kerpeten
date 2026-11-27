import type { z } from "zod";
import { Tool, Use } from "../../src/harness-kit/index.ts";
import { Marker } from "./Marker.ts";
import { slowInput } from "./schemas/fake-schema.ts";

@Tool({ name: "slow", description: "Reads its marker across a timer, a file stream and a process.", input: slowInput })
export class SlowTool {
  @Use(Marker)
  private readonly marker!: Marker;

  public peek(): Marker {
    return this.marker;
  }

  public async execute(input: z.infer<typeof slowInput>): Promise<unknown> {
    const seen = [this.marker.id];

    await Bun.sleep(input.waitMs);
    seen.push(this.marker.id);

    const reader = Bun.file(input.file).stream().getReader();

    await reader.read();
    await reader.cancel();
    seen.push(this.marker.id);

    await Bun.spawn([process.execPath, "--version"], { stdout: "ignore", stderr: "ignore" }).exited;
    seen.push(this.marker.id);

    return seen;
  }
}

import { Tool } from "@kerpetensh/harness-kit";
import { readInput } from "./schemas/harnesses-schema.ts";

/** A tool that never ends, to see that a harness does not wait for it past its time limit. */
@Tool({ name: "wait_forever", description: "never ends", input: readInput })
export class HangingTool {
  public execute(): Promise<never> {
    return new Promise<never>(() => {});
  }
}

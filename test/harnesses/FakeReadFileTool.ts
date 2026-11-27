import type { z } from "zod";
import { Tool } from "../../src/harness-kit/index.ts";
import { readInput } from "../harness-kit/schemas/fake-schema.ts";

@Tool({ name: "read_file", description: "read", input: readInput })
export class FakeReadFileTool {
  public execute(_input: z.infer<typeof readInput>): unknown {
    return { content: "1: x" };
  }
}

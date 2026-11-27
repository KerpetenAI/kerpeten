import type { z } from "zod";
import { Tool } from "../../src/harness-kit/index.ts";
import { bodies } from "./harness-kit-utils.ts";
import { readInput } from "./schemas/fake-schema.ts";

@Tool({ name: "read_file", description: "read", input: readInput })
export class FakeReadFileTool {
  public execute(input: z.infer<typeof readInput>): unknown {
    bodies.push({ name: "read_file", input });

    return { content: "1: x" };
  }
}

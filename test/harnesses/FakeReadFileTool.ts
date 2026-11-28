import { Tool } from "@kerpetensh/harness-kit";
import type { z } from "zod";
import { readInput } from "./schemas/harnesses-schema.ts";

@Tool({ name: "read_file", description: "read", input: readInput })
export class FakeReadFileTool {
  public execute(_input: z.infer<typeof readInput>): unknown {
    return { content: "1: x" };
  }
}

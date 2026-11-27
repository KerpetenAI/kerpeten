import type { z } from "zod";
import { Tool, Use } from "../../src/harness-kit/index.ts";
import { bodies } from "./harness-kit-utils.ts";
import { Reader } from "./Reader.ts";
import { listInput } from "./schemas/fake-schema.ts";

@Tool({ name: "list", description: "list a directory", input: listInput })
export class FakeListTool {
  @Use(Reader)
  private readonly reader!: Reader;

  public execute(input: z.infer<typeof listInput>): unknown {
    bodies.push({ name: "list", input });

    return { entries: this.reader.read(input.path) };
  }
}

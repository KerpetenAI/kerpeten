import { Tool, Use } from "../../../src/harness-kit/index.ts";
import { emptyInput } from "../schemas/fake-schema.ts";
import { SharedSource } from "./SharedSource.ts";

@Tool({ name: "shared_read", description: "Reads the shared source.", input: emptyInput })
export class SharedReadTool {
  @Use(SharedSource)
  private readonly source!: SharedSource;

  public execute(): unknown {
    return { source: this.source, label: this.source.label };
  }
}

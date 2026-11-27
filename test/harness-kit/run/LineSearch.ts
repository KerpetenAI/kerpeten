import { Capability, CapabilityBase, Use } from "../../../src/harness-kit/index.ts";
import { LineReader } from "./LineReader.ts";

/** Searches with the reader it takes; its own use of the reader is not checked against the permission group. */
@Capability({ name: "line-search", description: "Finds a line.", permission: "repo:search", scope: "run" })
export class LineSearch extends CapabilityBase {
  @Use(LineReader)
  private readonly reader!: LineReader;

  public find(pattern: string): string {
    return `${pattern} in ${this.reader.read(".")}`;
  }
}

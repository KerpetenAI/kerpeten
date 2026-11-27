import { Use } from "../../src/harness-kit/index.ts";
import { Reader } from "./Reader.ts";

export abstract class ReadingTool {
  @Use(Reader)
  protected readonly reader!: Reader;
}

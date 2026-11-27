import { Harness, type ToolClass } from "../../src/harness-kit/index.ts";
import { FakeReadFileTool } from "./FakeReadFileTool.ts";
import { TestHarness } from "./TestHarness.ts";

@Harness({
  name: "hollow",
  tools: [FakeReadFileTool, undefined as unknown as ToolClass],
  permissions: [],
})
export class HollowHarness extends TestHarness {}

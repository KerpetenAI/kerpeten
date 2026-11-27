import { Harness, type ToolClass } from "../../src/harness-kit/index.ts";
import { FakeGrepTool } from "./FakeGrepTool.ts";
import { GitHeadTool } from "./GitHeadTool.ts";
import { TestHarness } from "./TestHarness.ts";
import { UnmarkedTool } from "./UnmarkedTool.ts";
import { UnmarkedUseTool } from "./UnmarkedUseTool.ts";

@Harness({
  name: "broken",
  tools: [FakeGrepTool, FakeGrepTool, UnmarkedTool as unknown as ToolClass, GitHeadTool, UnmarkedUseTool],
  permissions: ["repo:write"],
})
export class BrokenHarness extends TestHarness {}

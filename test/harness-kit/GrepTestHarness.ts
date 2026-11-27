import { Harness } from "../../src/harness-kit/index.ts";
import { FakeGrepTool } from "./FakeGrepTool.ts";
import { FakeReadFileTool } from "./FakeReadFileTool.ts";
import { TestHarness } from "./TestHarness.ts";

@Harness({ name: "test-with-grep", tools: [FakeReadFileTool, FakeGrepTool], permissions: ["repo:search"] })
export class GrepTestHarness extends TestHarness {}

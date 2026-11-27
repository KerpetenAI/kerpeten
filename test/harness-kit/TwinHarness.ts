import { Harness } from "../../src/harness-kit/index.ts";
import { FakeReadFileTool } from "./FakeReadFileTool.ts";
import { TestHarness } from "./TestHarness.ts";

@Harness({ name: "test", tools: [FakeReadFileTool], permissions: [] })
export class TwinHarness extends TestHarness {}
